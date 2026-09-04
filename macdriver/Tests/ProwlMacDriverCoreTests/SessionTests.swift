import AppKit
import ApplicationServices
import CoreGraphics
@testable import ProwlMacDriverCore
import XCTest

final class SessionTests: XCTestCase {
    func testLaunchReusesUnblockedRunningInstance() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let (session, _, _) = makeSession(workspace: workspace)

        let result = try session.launch(app: "com.example.App", timeout: 1.0)

        XCTAssertEqual(result["pid"] as? Int, 101)
        XCTAssertEqual(workspace.openApplicationCallCount, 0)
    }

    func testQuitReturnsTerminatedWhenGracefulExitCompletes() throws {
        let app = FakeRunningApplication(pid: 101)
        app.onTerminate = { app.isTerminated = true }
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let menuController = FakeStatusMenuController(result: true)
        let (session, _, _) = makeSession(workspace: workspace, menuController: menuController)

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = session.quit()

        XCTAssertEqual(result["quit"] as? Bool, true)
        XCTAssertEqual(result["state"] as? String, "terminated")
        XCTAssertEqual(app.terminateCallCount, 1)
        XCTAssertEqual(app.forceTerminateCallCount, 0)
        XCTAssertEqual(menuController.dismissCallCount, 1)
        XCTAssertEqual(menuController.receivedApp, true)
    }

    func testQuitReturnsForcedWhenGracefulExitStalls() throws {
        let app = FakeRunningApplication(pid: 101)
        app.onForceTerminate = { app.isTerminated = true }
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let (session, _, _) = makeSession(workspace: workspace, terminationTimeout: 0.1)

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = session.quit()

        XCTAssertEqual(result["quit"] as? Bool, true)
        XCTAssertEqual(result["state"] as? String, "forced")
        XCTAssertEqual(app.terminateCallCount, 1)
        XCTAssertEqual(app.forceTerminateCallCount, 1)
    }

    func testTimedOutQuitBlocksSamePidUntilItDisappearsBeforeReplacementLaunch() throws {
        let oldApp = FakeRunningApplication(pid: 101)
        let replacement = FakeRunningApplication(pid: 202)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [oldApp] }
        workspace.launchedApplication = replacement
        let (session, clock, _) = makeSession(workspace: workspace, terminationTimeout: 0.1)

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let quitResult = session.quit()

        XCTAssertEqual(quitResult["quit"] as? Bool, false)
        XCTAssertEqual(quitResult["state"] as? String, "timedOut")

        var lookupCount = 0
        workspace.runningApplicationsForBundle = { _ in
            lookupCount += 1
            return lookupCount == 1 ? [oldApp] : []
        }

        let launchResult = try session.launch(app: "com.example.App", timeout: 1.0)

        XCTAssertEqual(launchResult["pid"] as? Int, 202)
        XCTAssertEqual(workspace.openApplicationCallCount, 1)
        XCTAssertGreaterThan(clock.sleepCallCount, 0)
    }

    func testLaunchFailsWhileTimedOutPidRemainsAlive() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let (session, _, _) = makeSession(workspace: workspace, terminationTimeout: 0.1)

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let quitResult = session.quit()

        XCTAssertEqual(quitResult["state"] as? String, "timedOut")
        XCTAssertThrowsError(try session.launch(app: "com.example.App", timeout: 0.1)) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("waiting for previous com.example.App instance(s) to exit"))
        }
        XCTAssertEqual(workspace.openApplicationCallCount, 0)
    }

    func testLaunchThrowsWhenSelectedAppTerminatesDuringLaunchWait() throws {
        let app = FakeRunningApplication(pid: 101, isFinishedLaunching: false)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let (session, clock, _) = makeSession(workspace: workspace)
        clock.onSleep = {
            app.isTerminated = true
            app.isFinishedLaunching = true
        }

        XCTAssertThrowsError(try session.launch(app: "com.example.App", timeout: 1.0)) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("terminated during launch"))
        }
    }

    func testRunScreencaptureTimesOutAndReportsAXFailure() {
        let started = Date()

        XCTAssertThrowsError(try Session.runScreencapture(
            arguments: ["5"],
            timeout: 0.1,
            executableURL: URL(fileURLWithPath: "/bin/sleep")
        )) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("screencapture timed out after 0.1s"))
            XCTAssertTrue(failure.message.contains("terminated the capture process"))
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 2.0)
    }

    func testRunScreencapturePreservesNonZeroExitFailureBeforeTimeout() {
        XCTAssertThrowsError(try Session.runScreencapture(
            arguments: ["-c", "exit 7"],
            timeout: 5.0,
            executableURL: URL(fileURLWithPath: "/bin/sh")
        )) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertEqual(failure.message, "screencapture exited with status 7")
        }
    }

    func testScreenshotCapturesFrontmostWindowOfAttachedApp() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        var captured: [[String]] = []
        // Front-to-back z-order: another app's window is frontmost, then our
        // app's status-menu layer, then our app's real windows. Selection must
        // skip the other owner and the non-zero layer and take window 42.
        let windows: [[String: Any]] = [
            window(pid: 999, layer: 0, number: 1),
            window(pid: 101, layer: 25, number: 2),
            window(pid: 101, layer: 0, number: 42),
            window(pid: 101, layer: 0, number: 43)
        ]
        let (session, _, _) = makeSession(
            workspace: workspace,
            listOnScreenWindows: { windows },
            runScreencapture: { captured.append($0) }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = try session.screenshot(path: "/tmp/out.png")

        XCTAssertEqual(result["scope"] as? String, "window")
        XCTAssertEqual(result["path"] as? String, "/tmp/out.png")
        XCTAssertNil(result["warning"])
        XCTAssertEqual(captured, [["-x", "-l", "42", "/tmp/out.png"]])
    }

    func testScreenshotFallsBackToFullScreenWithWarningWhenNoWindow() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        var captured: [[String]] = []
        // Our app is present only at a menu layer (menu-only / status-menu-open
        // state) — no layer-0 window to scope to.
        let (session, _, _) = makeSession(
            workspace: workspace,
            listOnScreenWindows: { [self.window(pid: 101, layer: 25, number: 2)] },
            runScreencapture: { captured.append($0) }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = try session.screenshot(path: "/tmp/out.png")

        XCTAssertEqual(result["scope"] as? String, "fullScreen")
        XCTAssertEqual(result["path"] as? String, "/tmp/out.png")
        XCTAssertNotNil(result["warning"] as? String)
        XCTAssertEqual(captured, [["-x", "/tmp/out.png"]])
    }

    private func window(pid: Int, layer: Int, number: Int) -> [String: Any] {
        [
            kCGWindowOwnerPID as String: pid,
            kCGWindowLayer as String: layer,
            kCGWindowNumber as String: number
        ]
    }

    func testCloseMenuPropagatesCancelFailure() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let menuController = FakeStatusMenuController(result: false)
        let (session, _, _) = makeSession(workspace: workspace, menuController: menuController)

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = try session.closeMenu()

        XCTAssertEqual(result["closed"] as? Bool, false)
        XCTAssertEqual(menuController.dismissCallCount, 1)
        XCTAssertEqual(menuController.receivedApp, true)
    }

    func testPressUsesAXPressForPressableActivationKey() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let target = AXUIElementCreateSystemWide()
        var supportQueries: [String] = []
        var pressCallCount = 0
        var posted: [(Keystroke, pid_t)] = []

        let (session, _, _) = makeSession(
            workspace: workspace,
            resolveFirstElement: { _, query in
                guard case .identifier(let value) = query else {
                    XCTFail("expected id query")
                    return nil
                }
                XCTAssertEqual(value, "submit")
                return target
            },
            supportsAction: { _, action in
                supportQueries.append(action)
                return true
            },
            performPressAction: { _ in
                pressCallCount += 1
                return .success
            },
            focusElement: { _ in
                XCTFail("AXPress fast path should not focus the element")
                return .success
            },
            postKeystroke: { keystroke, pid in posted.append((keystroke, pid)) }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = try session.press(["by": "id", "value": "submit"], key: "Enter")

        XCTAssertEqual(result["pressed"] as? String, "Enter")
        XCTAssertEqual(result["via"] as? String, "axpress")
        XCTAssertEqual(supportQueries, [kAXPressAction as String])
        XCTAssertEqual(pressCallCount, 1)
        XCTAssertEqual(app.activateCallCount, 0)
        XCTAssertTrue(posted.isEmpty)
    }

    func testPressSynthesizesKeystrokeToAttachedPidAfterActivationAndFocus() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let target = AXUIElementCreateSystemWide()
        var supportQueryCount = 0
        var focusCallCount = 0
        var posted: [(Keystroke, pid_t)] = []

        let (session, _, _) = makeSession(
            workspace: workspace,
            resolveFirstElement: { _, _ in target },
            supportsAction: { _, _ in
                supportQueryCount += 1
                return true
            },
            performPressAction: { _ in
                XCTFail("non-activation keys should not use AXPress")
                return .success
            },
            focusElement: { _ in
                focusCallCount += 1
                return .success
            },
            postKeystroke: { keystroke, pid in posted.append((keystroke, pid)) }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)
        let result = try session.press(["by": "focused"], key: "Control+a")

        XCTAssertEqual(result["pressed"] as? String, "Control+a")
        XCTAssertEqual(result["via"] as? String, "cgevent")
        XCTAssertEqual(supportQueryCount, 0)
        XCTAssertEqual(app.activateCallCount, 1)
        XCTAssertEqual(focusCallCount, 1)
        XCTAssertEqual(posted.count, 1)
        XCTAssertEqual(posted[0].1, 101)
        XCTAssertEqual(posted[0].0.keyCode, 0)
        XCTAssertTrue(posted[0].0.flags.contains(.maskControl))
        XCTAssertNil(posted[0].0.unicodeString)
    }

    func testPressPropagatesActionQueryFailureBeforeFallbackSynthesis() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let target = AXUIElementCreateSystemWide()
        let (session, _, _) = makeSession(
            workspace: workspace,
            resolveFirstElement: { _, _ in target },
            supportsAction: { _, _ in throw AXFailure("could not query actions for element (-25204)") },
            focusElement: { _ in
                XCTFail("action query failures should not fall through to synthesis")
                return .success
            },
            postKeystroke: { _, _ in XCTFail("action query failures should not post events") }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)

        XCTAssertThrowsError(try session.press(["by": "focused"], key: "Space")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("could not query actions"))
        }
        XCTAssertEqual(app.activateCallCount, 0)
    }

    func testPressThrowsWhenActivationFailsBeforePosting() throws {
        let app = FakeRunningApplication(pid: 101)
        app.activateResult = false
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let target = AXUIElementCreateSystemWide()
        let (session, _, _) = makeSession(
            workspace: workspace,
            resolveFirstElement: { _, _ in target },
            focusElement: { _ in
                XCTFail("activation failure should stop before focus")
                return .success
            },
            postKeystroke: { _, _ in XCTFail("activation failure should stop before posting") }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)

        XCTAssertThrowsError(try session.press(["by": "focused"], key: "Escape")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("could not activate target app"))
        }
        XCTAssertEqual(app.activateCallCount, 1)
    }

    func testPressThrowsWhenElementFocusFailsBeforePosting() throws {
        let app = FakeRunningApplication(pid: 101)
        let workspace = FakeWorkspace()
        workspace.runningApplicationsForBundle = { _ in [app] }
        let target = AXUIElementCreateSystemWide()
        let (session, _, _) = makeSession(
            workspace: workspace,
            resolveFirstElement: { _, _ in target },
            focusElement: { _ in .cannotComplete },
            postKeystroke: { _, _ in XCTFail("focus failure should stop before posting") }
        )

        _ = try session.launch(app: "com.example.App", timeout: 1.0)

        XCTAssertThrowsError(try session.press(["by": "focused"], key: "Escape")) { error in
            guard let failure = error as? AXFailure else {
                return XCTFail("expected AXFailure, got \(error)")
            }
            XCTAssertTrue(failure.message.contains("could not focus element"))
            XCTAssertTrue(failure.message.contains("\(AXError.cannotComplete.rawValue)"))
        }
        XCTAssertEqual(app.activateCallCount, 1)
    }

    private func makeSession(
        workspace: FakeWorkspace,
        menuController: FakeStatusMenuController = FakeStatusMenuController(result: true),
        terminationTimeout: TimeInterval = 0.5,
        listOnScreenWindows: @escaping () -> [[String: Any]] = { [] },
        runScreencapture: @escaping ([String]) throws -> Void = { _ in },
        resolveFirstElement: @escaping (AXUIElement, Query) -> AXUIElement? = { root, query in
            resolveFirst(root: root, query: query)
        },
        supportsAction: @escaping (AXUIElement, String) throws -> Bool = { _, _ in false },
        performPressAction: @escaping (AXUIElement) -> AXError = { _ in .success },
        focusElement: @escaping (AXUIElement) -> AXError = { _ in .success },
        postKeystroke: @escaping (Keystroke, pid_t) throws -> Void = { _, _ in }
    ) -> (Session, ManualClock, FakeStatusMenuController) {
        let clock = ManualClock()
        let session = Session(
            workspace: workspace,
            statusMenuController: menuController,
            isProcessTrusted: { true },
            createApplication: { _ in AXUIElementCreateSystemWide() },
            setMessagingTimeout: { _, _ in },
            resolveFirstElement: resolveFirstElement,
            supportsAction: supportsAction,
            performPressAction: performPressAction,
            focusElement: focusElement,
            postKeystroke: postKeystroke,
            now: clock.now,
            sleep: clock.sleep,
            terminationTimeout: terminationTimeout,
            listOnScreenWindows: listOnScreenWindows,
            runScreencapture: runScreencapture
        )
        return (session, clock, menuController)
    }
}

private final class FakeRunningApplication: RunningApplication {
    let processIdentifier: pid_t
    var bundleIdentifier: String?
    var isFinishedLaunching: Bool
    var isTerminated: Bool
    var terminateCallCount = 0
    var forceTerminateCallCount = 0
    var activateCallCount = 0
    var activateResult = true
    var terminateResult = true
    var forceTerminateResult = true
    var onTerminate: (() -> Void)?
    var onForceTerminate: (() -> Void)?

    init(
        pid: pid_t,
        bundleIdentifier: String = "com.example.App",
        isFinishedLaunching: Bool = true,
        isTerminated: Bool = false
    ) {
        self.processIdentifier = pid
        self.bundleIdentifier = bundleIdentifier
        self.isFinishedLaunching = isFinishedLaunching
        self.isTerminated = isTerminated
    }

    func activate(options _: NSApplication.ActivationOptions) -> Bool {
        activateCallCount += 1
        return activateResult
    }

    func terminate() -> Bool {
        terminateCallCount += 1
        onTerminate?()
        return terminateResult
    }

    func forceTerminate() -> Bool {
        forceTerminateCallCount += 1
        onForceTerminate?()
        return forceTerminateResult
    }
}

private final class FakeWorkspace: WorkspaceClient {
    var runningApplicationsForBundle: (String) -> [RunningApplication] = { _ in [] }
    var applicationURL: URL? = URL(fileURLWithPath: "/Applications/Fake.app")
    var launchedApplication: RunningApplication?
    var launchError: Error?
    var openApplicationCallCount = 0

    func runningApplications(withBundleIdentifier bundleIdentifier: String) -> [RunningApplication] {
        runningApplicationsForBundle(bundleIdentifier)
    }

    func urlForApplication(withBundleIdentifier _: String) -> URL? {
        applicationURL
    }

    func openApplication(
        at _: URL,
        configuration _: NSWorkspace.OpenConfiguration,
        completionHandler: @escaping (RunningApplication?, Error?) -> Void
    ) {
        openApplicationCallCount += 1
        completionHandler(launchedApplication, launchError)
    }
}

private final class FakeStatusMenuController: StatusMenuController {
    let result: Bool
    private(set) var dismissCallCount = 0
    private(set) var receivedApp = false

    init(result: Bool) {
        self.result = result
    }

    func dismissOpenStatusMenu(app: AXUIElement?) -> Bool {
        dismissCallCount += 1
        receivedApp = app != nil
        return result
    }
}

private final class ManualClock {
    private var current = Date(timeIntervalSince1970: 0)
    private(set) var sleepCallCount = 0
    var onSleep: (() -> Void)?

    func now() -> Date {
        current
    }

    func sleep(_ microseconds: useconds_t) {
        sleepCallCount += 1
        current = current.addingTimeInterval(Double(microseconds) / 1_000_000)
        onSleep?()
    }
}
