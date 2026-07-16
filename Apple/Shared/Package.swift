// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "OmonativeShared", platforms: [.macOS(.v14), .iOS(.v17)], products: [.library(name: "OmonativeShared", targets: ["OmonativeShared"])], targets: [.target(name: "OmonativeShared"), .testTarget(name: "OmonativeSharedTests", dependencies: ["OmonativeShared"])])
