import Foundation
import Security

public enum ProviderID: String, Codable, CaseIterable, Sendable { case senpi, grok }
public enum SessionStatus: String, Codable, Sendable { case idle, streaming, cancelled }
public struct Session: Codable, Identifiable, Sendable { public let id: String; public let provider: ProviderID; public let projectId: String; public let title: String; public let generation: Int; public let updatedAt: Date; public let status: SessionStatus }
public struct Provider: Codable, Identifiable, Sendable { public let id: ProviderID; public let available: Bool; public let transport: String; public let detail: String; public let capabilities: [String] }
public struct TranscriptEvent: Codable, Identifiable, Sendable { public let id: Int; public let type: String; public let role: String?; public let text: String?; public let generation: Int; public let at: Date }
public enum GatewayError: LocalizedError, Sendable { case invalidEndpoint, unauthorized, http(Int), malformedResponse; public var errorDescription: String? { switch self { case .invalidEndpoint: return "Enter an HTTPS Tailscale origin without a path."; case .unauthorized: return "The pairing credential is no longer valid."; case .http(let code): return "Gateway request failed (HTTP \(code))."; case .malformedResponse: return "Gateway returned an invalid response." } } }
public struct GatewayEndpoint: Sendable, Hashable { public let url: URL; public init(_ raw: String, allowingLoopbackHTTP: Bool = false) throws { guard var c = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)), let host = c.host, !host.isEmpty, c.user == nil, c.password == nil, (c.path.isEmpty || c.path == "/"), c.query == nil, c.fragment == nil else { throw GatewayError.invalidEndpoint }; let loopback = ["127.0.0.1", "localhost", "::1"].contains(host); guard c.scheme == "https" || (allowingLoopbackHTTP && c.scheme == "http" && loopback) else { throw GatewayError.invalidEndpoint }; c.path = ""; guard let url = c.url else { throw GatewayError.invalidEndpoint }; self.url = url } }
public struct SSEEvent: Sendable, Equatable { public let event: String; public let data: String }
public struct SSEParser: Sendable {
 private var buffer = ""
 public init() {}
 public mutating func append(_ chunk: String) -> [SSEEvent] {
  buffer += chunk.replacingOccurrences(of: "\r\n", with: "\n"); var output: [SSEEvent] = []
  while let range = buffer.range(of: "\n\n") { let block = String(buffer[..<range.lowerBound]); buffer.removeSubrange(..<range.upperBound); var event = "message"; var data: [String] = []; for line in block.split(separator: "\n", omittingEmptySubsequences: false) { if line.hasPrefix("event:") { event = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces) }; if line.hasPrefix("data:") { data.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)) } }; if !data.isEmpty { output.append(SSEEvent(event: event, data: data.joined(separator: "\n"))) } }
  return output
 }
}
public final class KeychainStore: @unchecked Sendable {
 public init() {}
 public func save(_ value: String, account: String, service: String = "com.ilseoblee.omonative") throws { SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary); let status = SecItemAdd([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecValueData: Data(value.utf8)] as CFDictionary, nil); guard status == errSecSuccess else { throw GatewayError.malformedResponse } }
 public func load(account: String, service: String = "com.ilseoblee.omonative") -> String? { var found: CFTypeRef?; guard SecItemCopyMatching([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account, kSecReturnData: true] as CFDictionary, &found) == errSecSuccess, let data = found as? Data else { return nil }; return String(data: data, encoding: .utf8) }
 public func delete(account: String, service: String = "com.ilseoblee.omonative") { SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary) }
}
public actor APIClient {
 public static let decoder: JSONDecoder = { let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601; return decoder }()
 public let baseURL: URL; private let token: String?; private let session: URLSession
 public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) { self.baseURL = baseURL; self.token = token; self.session = session }
 private func request(_ path: String, method: String = "GET", body: Data? = nil, generation: Int? = nil) async throws -> Data { var request = URLRequest(url: baseURL.appending(path: path)); request.httpMethod = method; request.httpBody = body; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }; if let generation { request.setValue("\"generation-\(generation)\"", forHTTPHeaderField: "If-Match") }; let (data, response) = try await session.data(for: request); let code = (response as? HTTPURLResponse)?.statusCode ?? 0; if code == 401 { throw GatewayError.unauthorized }; guard (200..<300).contains(code) else { throw GatewayError.http(code) }; return data }
 public func pair(code: String, scopes: [String]) async throws -> String { struct PairRequest: Encodable { let code: String; let scopes: [String] }; struct Reply: Decodable { let token: String }; let body = try JSONEncoder().encode(PairRequest(code: code, scopes: scopes)); return try Self.decoder.decode(Reply.self, from: await request("api/v1/pairing/exchange", method: "POST", body: body)).token }
 public func providers() async throws -> [Provider] { struct Reply: Decodable { let providers: [Provider] }; return try Self.decoder.decode(Reply.self, from: await request("api/v1/providers")).providers }
 public func sessions() async throws -> [Session] { struct Reply: Decodable { let sessions: [Session] }; return try Self.decoder.decode(Reply.self, from: await request("api/v1/sessions")).sessions }
 public func transcript(_ id: String) async throws -> [TranscriptEvent] { struct Reply: Decodable { let events: [TranscriptEvent] }; return try Self.decoder.decode(Reply.self, from: await request("api/v1/sessions/\(id)/transcript")).events }
 public func send(_ id: String, text: String, generation: Int) async throws -> Session { struct Body: Encodable { let text: String }; struct Reply: Decodable { let session: Session }; return try Self.decoder.decode(Reply.self, from: await request("api/v1/sessions/\(id)/messages", method: "POST", body: try JSONEncoder().encode(Body(text: text)), generation: generation)).session }
 public func cancel(_ id: String, generation: Int) async throws -> Session { struct Body: Encodable { let confirm: Bool }; struct Reply: Decodable { let session: Session }; return try Self.decoder.decode(Reply.self, from: await request("api/v1/sessions/\(id)/cancel", method: "POST", body: try JSONEncoder().encode(Body(confirm: true)), generation: generation)).session }
}
