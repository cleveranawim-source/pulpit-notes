import UIKit
import Capacitor
import UniformTypeIdentifiers

/// 강단노트 화면 — Capacitor 기본 화면에 앱 전용 플러그인을 더한다.
class PulpitViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderPickerPlugin())
    }
}

/// 파일 앱 선택 창을 직접 띄운다(웹의 <input type=file> 대신).
/// - 시작 폴더는 정하지 않는다. 그러면 선택 창이 이 앱에서 마지막으로 보던 폴더를 스스로 기억해 연다.
///   directoryURL 을 주면 그 기억을 덮어쓰는데, 구글 드라이브처럼 파일마다 보관 칸을 따로 두는
///   저장소에서는 '파일이 든 폴더' 경로가 실제 폴더가 아니어서 늘 '최근 항목'으로 열렸다.
/// - 원본 자리에서 열어(asCopy: false) 조율된 읽기로 내려받은 뒤, 임시 폴더로 복사해 넘긴다.
/// - 내려받는 동안 'progress' 알림을 보내고(JS 가 '받는 중'과 취소 버튼을 띄움), 1분이 지나거나 취소하면 멈춘다.
///   구글 드라이브가 '와이파이에서만 전송'이면 셀룰러에서는 영영 받지 못해 아무 표시 없이 멈춰 있었다.
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var kind = "pdf"
    private let lock = NSLock()
    private var coordinator: NSFileCoordinator?
    private var cancelled = false
    private static let downloadTimeout: TimeInterval = 60

    override public func load() {
        // 1.0.1(3) 까지 쓰던 시작 폴더 기록은 이제 쓰지 않는다
        for k in ["pdf", "zip"] { UserDefaults.standard.removeObject(forKey: "pn.lastFolder." + k) }
    }

    @objc func pick(_ call: CAPPluginCall) {
        let kind = call.getString("kind") == "zip" ? "zip" : "pdf"
        let multiple = call.getBool("multiple") ?? false
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: kind == "zip" ? [.zip] : [.pdf], asCopy: false)
            picker.allowsMultipleSelection = multiple
            picker.delegate = self
            self.pending?.resolve(["files": [], "failed": []])
            self.pending = call
            self.kind = kind
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// 내려받는 중인 파일을 그만 받는다(JS '취소' 버튼)
    @objc func cancel(_ call: CAPPluginCall) {
        lock.lock(); cancelled = true; let c = coordinator; lock.unlock()
        c?.cancel()
        call.resolve()
    }

    private var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["files": [], "failed": []])
        pending = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        pending = nil
        let kind = self.kind
        lock.lock(); cancelled = false; lock.unlock()
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let tmp = fm.temporaryDirectory.appendingPathComponent("picked", isDirectory: true)
            try? fm.removeItem(at: tmp) // 지난번 시간 초과 뒤 늦게 복사된 파일 정리(JS 는 받은 파일을 읽고 지운다)
            try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
            var files: [[String: String]] = []
            var failed: [[String: String]] = []
            for (i, url) in urls.enumerated() {
                let name = url.lastPathComponent
                if self.isCancelled { failed.append(["name": name, "reason": "cancel"]); continue }
                self.notifyListeners("progress", data: ["index": i + 1, "total": urls.count, "name": name])
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let dst = tmp.appendingPathComponent(UUID().uuidString + "." + (kind == "zip" ? "zip" : "pdf"))
                if let reason = self.copyCoordinated(url, to: dst) {
                    failed.append(["name": name, "reason": reason])
                } else {
                    files.append(["path": dst.absoluteString, "name": name])
                }
            }
            call.resolve(["files": files, "failed": failed])
        }
    }

    /// 조율된 읽기로 복사한다 — 클라우드(구글 드라이브 · iCloud)에만 있는 파일은 이때 내려받는다.
    /// 성공하면 nil, 아니면 이유("timeout" · "cancel" · "error").
    private func copyCoordinated(_ url: URL, to dst: URL) -> String? {
        final class Outcome { var reason: String? = "error" }
        let coord = NSFileCoordinator()
        lock.lock(); coordinator = coord; lock.unlock()
        defer { lock.lock(); coordinator = nil; lock.unlock() }
        let intent = NSFileAccessIntent.readingIntent(with: url, options: [.withoutChanges])
        let done = DispatchSemaphore(value: 0), out = Outcome()
        coord.coordinate(with: [intent], queue: OperationQueue()) { err in
            if let err = err as NSError? {
                out.reason = err.code == NSUserCancelledError ? "cancel" : "error"
                CAPLog.print("⚡️ 강단노트: 파일 읽기 실패 \(err)")
            } else {
                do { try FileManager.default.copyItem(at: intent.url, to: dst); out.reason = nil }
                catch { CAPLog.print("⚡️ 강단노트: 파일 복사 실패 \(error)") }
            }
            done.signal()
        }
        if done.wait(timeout: .now() + Self.downloadTimeout) == .timedOut {
            coord.cancel()
            // 취소 직전에 다 받아 복사까지 끝났다면 그대로 쓴다(늦게 끝난 복사는 다음 선택 때 정리)
            if done.wait(timeout: .now() + 5) == .success, out.reason == nil { return nil }
            return isCancelled ? "cancel" : "timeout"
        }
        if out.reason != nil && isCancelled { return "cancel" }
        return out.reason
    }
}
