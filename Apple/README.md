# Omodesu native apps

`Omodesu.xcodeproj` contains native SwiftUI macOS and iOS targets with deployment targets macOS 14 and iOS 17. Both use `URLSession`; there is no WebView or embedded React runtime.

## Signing

Every configuration uses automatic signing and the development team **U48VX8D6WT**. Bundle identifiers are `com.ilseoblee.omodesu.mac` and `com.ilseoblee.omodesu.ios`. The macOS build phase rejects any other team value. Use `-allowProvisioningUpdates DEVELOPMENT_TEAM=U48VX8D6WT` only with credentials belonging to that team.

## Build

```sh
swift test --package-path Apple/Shared
ruby Apple/generate_project.rb
xcodebuild -project Omodesu.xcodeproj -scheme OmodesuMac -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Omodesu.xcodeproj -scheme OmodesuIOS -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The macOS target compiles `apps/gateway/src/index.ts` into a self-contained arm64 Bun executable and puts it in the app resources. It starts only its own child process on loopback, uses Application Support for the control DB, and passes an API-only static-root setting. iOS contains no Bun executable and only accepts HTTPS Tailscale origins during pairing.

For an iPhone, start the Mac app, run Tailscale Serve against the local gateway, generate a one-use code from the Mac pairing interface/sidecar, then enter the resulting HTTPS origin and code on iOS.
