// swift-tools-version: 6.0
import PackageDescription
let package = Package(name: "OmodesuShared", platforms: [.macOS(.v14), .iOS(.v17)], products: [.library(name: "OmodesuShared", targets: ["OmodesuShared"])], targets: [.target(name: "OmodesuShared"), .testTarget(name: "OmodesuSharedTests", dependencies: ["OmodesuShared"])])
