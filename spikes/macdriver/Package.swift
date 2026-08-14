// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "axspike",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "axspike", path: "Sources/axspike")
    ]
)
