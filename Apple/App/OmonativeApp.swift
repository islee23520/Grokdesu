import SwiftUI
#if os(macOS)
import AppKit
import Darwin

@MainActor final class OmonativeAppDelegate: NSObject, NSApplicationDelegate {
 var stopGateway: (() -> Void)?

 func applicationWillTerminate(_ notification: Notification) {
  stopGateway?()
 }
}
#endif

@main struct OmonativeApp: App {
 @StateObject private var model = AppModel()
 #if os(macOS)
 @NSApplicationDelegateAdaptor(OmonativeAppDelegate.self) private var appDelegate
 #endif

 var body: some Scene {
  WindowGroup {
   RootView(model: model)
    #if os(macOS)
    .onAppear {
     appDelegate.stopGateway = { model.stopLocalGateway() }
    }
    #endif
  }
 }
}

@MainActor final class AppModel: ObservableObject {
 @Published var endpoint = ""
 @Published var code = ""
 @Published var status = "Not connected"
 @Published var isConnected = false
 @Published var sessions: [Session] = []
 @Published var selected: Session?
 @Published var transcript: [TranscriptEvent] = []
 @Published var text = ""
 private let keychain = KeychainStore()
 private var client: APIClient?
 #if os(macOS)
 private var gateway: Process?
 #endif

 init() {
  endpoint = UserDefaults.standard.string(forKey: "gatewayURL") ?? ""
  #if os(macOS)
  Task { await startLocalGateway() }
  #endif
 }

 func connect() async {
  do {
   let origin = try GatewayEndpoint(endpoint)
   let token = try await APIClient(baseURL: origin.url).pair(code: code, scopes: ["metadata:read", "transcript:read", "session:create", "session:send", "session:cancel"])
   try keychain.save(token, account: "gateway-token")
   UserDefaults.standard.set(origin.url.absoluteString, forKey: "gatewayURL")
   client = APIClient(baseURL: origin.url, token: token)
   isConnected = true
   code = ""
   await reload()
  } catch {
   status = error.localizedDescription
  }
 }

 func restore(url: URL) async {
  guard let token = keychain.load(account: "gateway-token") else { return }
  client = APIClient(baseURL: url, token: token)
  isConnected = true
  await reload()
 }

 func reload() async {
  guard let client else { return }
  do {
   sessions = try await client.sessions()
   status = "Connected"
   isConnected = true
   if let selected, !sessions.contains(where: { $0.id == selected.id }) {
    self.selected = sessions.first
   }
   if selected == nil { selected = sessions.first }
   if let selected { transcript = try await client.transcript(selected.id) }
  } catch GatewayError.unauthorized {
   keychain.delete(account: "gateway-token")
   isConnected = false
   status = "Credential expired. Pair again."
  } catch {
   status = error.localizedDescription
  }
 }

 func select(_ session: Session) async {
  selected = session
  guard let client else { return }
  do {
   transcript = try await client.transcript(session.id)
  } catch {
   status = error.localizedDescription
  }
 }

 func send() async {
  guard let client, let session = selected, !text.isEmpty else { return }
  let message = text
  text = ""
  do {
   _ = try await client.send(session.id, text: message, generation: session.generation)
   await reload()
  } catch {
   status = error.localizedDescription
  }
 }

 func cancel() async {
  guard let client, let session = selected else { return }
  do {
   _ = try await client.cancel(session.id, generation: session.generation)
   await reload()
  } catch {
   status = error.localizedDescription
  }
 }

 #if os(macOS)
 func stopLocalGateway() {
  guard let gateway else { return }
  self.gateway = nil
  guard gateway.isRunning else { return }

  gateway.terminate()
  let deadline = Date().addingTimeInterval(2)
  while gateway.isRunning && Date() < deadline {
   RunLoop.current.run(until: Date().addingTimeInterval(0.05))
  }
  if gateway.isRunning {
   kill(gateway.processIdentifier, SIGKILL)
  }
  gateway.waitUntilExit()
 }

 private func startLocalGateway() async {
  guard let executable = Bundle.main.url(forResource: "omonative-gateway", withExtension: nil) else {
   status = "Bundled gateway unavailable"
   return
  }
  let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Omonative")
  do {
   try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
   let process = Process()
   process.executableURL = executable
   process.environment = ProcessInfo.processInfo.environment.merging([
    "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (ProcessInfo.processInfo.environment["PATH"] ?? ""),
    "PORT": "8787",
    "OMONATIVE_HOST": "127.0.0.1",
    "OMONATIVE_DB_PATH": support.appending(path: "control.sqlite").path,
    "OMONATIVE_STATIC_ROOT": ""
   ]) { $1 }
   process.standardOutput = Pipe()
   process.standardError = Pipe()
   try process.run()
   gateway = process
   let url = try GatewayEndpoint("http://127.0.0.1:8787", allowingLoopbackHTTP: true).url
   try await waitForHealth(url)
   endpoint = url.absoluteString
   let pairingCode = try await runPair(executable: executable, environment: process.environment ?? [:])
   let token = try await APIClient(baseURL: url).pair(code: pairingCode, scopes: ["metadata:read", "transcript:read", "session:create", "session:send", "session:cancel"])
   try keychain.save(token, account: "gateway-token")
   client = APIClient(baseURL: url, token: token)
   isConnected = true
   await reload()
  } catch {
   status = "Gateway startup failed: \(error.localizedDescription)"
  }
 }

 private func waitForHealth(_ url: URL) async throws {
  for delay in [100_000_000, 250_000_000, 500_000_000, 1_000_000_000, 2_000_000_000] {
   if let (_, response) = try? await URLSession.shared.data(from: url.appending(path: "api/v1/health")),
      (response as? HTTPURLResponse)?.statusCode == 200 {
    return
   }
   try await Task.sleep(nanoseconds: UInt64(delay))
  }
  throw GatewayError.http(503)
 }

 private func runPair(executable: URL, environment: [String: String]) async throws -> String {
  let process = Process()
  let pipe = Pipe()
  process.executableURL = executable
  process.arguments = ["pair"]
  process.environment = environment
  process.standardOutput = pipe
  process.standardError = Pipe()
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0,
        let code = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
        !code.isEmpty else { throw GatewayError.malformedResponse }
  return code
 }
 #endif
}

struct RootView: View {
 @ObservedObject var model: AppModel
 var body: some View {
  content.task {
   if let url = try? GatewayEndpoint(model.endpoint).url {
    await model.restore(url: url)
   }
  }
 }

 @ViewBuilder var content: some View {
  #if os(macOS)
  NavigationSplitView {
   List(model.sessions) { session in
    Button { Task { await model.select(session) } } label: { SessionRow(session: session) }
   }
   .navigationTitle("Omonative")
  } detail: {
   ConversationView(model: model)
  }
  #else
  NavigationStack { ConversationView(model: model).navigationTitle("Omonative") }
  #endif
 }
}

struct SessionRow: View {
 let session: Session
 var body: some View {
  HStack {
   Circle().fill(session.provider == .senpi ? .purple : .orange).frame(width: 8, height: 8)
   VStack(alignment: .leading) {
    Text(session.title).lineLimit(1)
    Text(session.status.rawValue).font(.caption).foregroundStyle(.secondary)
   }
  }
 }
}

struct ConversationView: View {
 @ObservedObject var model: AppModel
 var body: some View {
  VStack(spacing: 0) {
   if !model.isConnected {
    PairingView(model: model)
   } else if model.sessions.isEmpty {
    ContentUnavailableView(
     "No sessions yet",
     systemImage: "tray",
     description: Text("Start a session in Senpi or Grok, or add New Session later.")
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
   } else if model.selected != nil {
    List(model.transcript) { event in
     if let text = event.text {
      HStack {
       if event.role == "assistant" {
        Text(text).padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
        Spacer()
       } else {
        Spacer()
        Text(text).padding(10).background(.tint.opacity(0.2), in: RoundedRectangle(cornerRadius: 12))
       }
      }
     }
    }
    .listStyle(.plain)
    HStack {
     TextField("Message", text: $model.text, axis: .vertical).textFieldStyle(.roundedBorder)
     Button("Send") { Task { await model.send() } }.disabled(model.text.isEmpty)
     Button("Cancel", role: .destructive) { Task { await model.cancel() } }.disabled(model.selected?.status != .streaming)
    }
    .padding()
   } else {
    ContentUnavailableView(
     "Select a session",
     systemImage: "message",
     description: Text("Choose a session from the sidebar to view its conversation.")
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
   }
   Divider()
   HStack {
    Text(model.status).font(.caption).foregroundStyle(.secondary)
    Spacer()
    Button("Refresh") { Task { await model.reload() } }
   }
   .padding()
  }
 }
}

struct PairingView: View {
 @ObservedObject var model: AppModel
 var body: some View {
  Form {
   Section("Connect to your Mac") {
    TextField("https://your-tailnet.ts.net", text: $model.endpoint)
    SecureField("One-use code", text: $model.code)
    Button("Pair") { Task { await model.connect() } }
     .disabled(model.endpoint.isEmpty || model.code.isEmpty)
   }
   Section {
    Text("Use Tailscale Serve on your Mac, then enter its HTTPS URL and one-use pairing code. Credentials stay in the system Keychain.")
     .font(.footnote)
     .foregroundStyle(.secondary)
   }
  }
  .padding()
  .frame(maxWidth: 520)
 }
}
