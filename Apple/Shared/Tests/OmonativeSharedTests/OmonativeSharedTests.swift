import XCTest
@testable import OmonativeShared

final class OmonativeSharedTests: XCTestCase {
    func testGatewayEndpointRequiresSecureOrigin() throws {
        XCTAssertEqual(try GatewayEndpoint("https://tailnet.ts.net/").url.absoluteString, "https://tailnet.ts.net")
        XCTAssertThrowsError(try GatewayEndpoint("http://tailnet.ts.net"))
        XCTAssertThrowsError(try GatewayEndpoint("http://127.0.0.1:8787"))
        XCTAssertEqual(try GatewayEndpoint("http://127.0.0.1:8787", allowingLoopbackHTTP: true).url.absoluteString, "http://127.0.0.1:8787")
        XCTAssertThrowsError(try GatewayEndpoint("https://tailnet.ts.net/path"))
    }
    func testSSEParserHandlesChunkBoundariesAndMultilineData() {
        var parser = SSEParser()
        XCTAssertEqual(parser.append("event: message\ndata: {\"text\":\"hello"), [])
        let events = parser.append("\"}\ndata: world\n\n")
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].event, "message")
        XCTAssertEqual(events[0].data, "{\"text\":\"hello\"}\nworld")
    }
    func testTranscriptDecodesTerminalEventsWithoutRoleOrText() throws {
        let event = try APIClient.decoder.decode(TranscriptEvent.self, from: Data("{\"id\":2,\"type\":\"complete\",\"generation\":3,\"at\":\"2026-01-01T12:00:00Z\"}".utf8))
        XCTAssertNil(event.role)
        XCTAssertNil(event.text)
    }
    func testISO8601DecodesFractionalTimestamp() throws {
        let session = try APIClient.decoder.decode(Session.self, from: Data("{\"id\":\"s\",\"provider\":\"senpi\",\"projectId\":\"p\",\"title\":\"T\",\"generation\":3,\"updatedAt\":\"2026-01-01T12:00:00Z\",\"status\":\"idle\"}".utf8))
        XCTAssertEqual(session.generation, 3)
        XCTAssertNotNil(session.updatedAt)
    }
}
