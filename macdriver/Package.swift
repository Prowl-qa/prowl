// swift-tools-version: 5.9
import PackageDescription

// prowl-macdriver — the Accessibility (AXUIElement) helper binary behind Prowl's
// experimental macOS execution target (PROWL-048 / ARCH-002). Built locally with
// `swift build`; intentionally NOT bundled in the npm tarball (distribution is a
// later phase). The TypeScript MacDriver spawns the `serve` mode and drives it
// over newline-delimited JSON on stdio.
let package = Package(
    name: "prowl-macdriver",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "prowl-macdriver", targets: ["prowl-macdriver"])
    ],
    targets: [
        .target(name: "ProwlMacDriverCore", path: "Sources/prowl-macdriver"),
        .executableTarget(
            name: "prowl-macdriver",
            dependencies: ["ProwlMacDriverCore"],
            path: "Sources/prowl-macdriver-cli"
        ),
        .testTarget(
            name: "ProwlMacDriverCoreTests",
            dependencies: ["ProwlMacDriverCore"]
        )
    ]
)
