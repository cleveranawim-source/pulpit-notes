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
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var kind = "pdf"

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
            self.pending?.resolve(["files": []])
            self.pending = call
            self.kind = kind
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["files": []])
        pending = nil
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pending else { return }
        pending = nil
        let kind = self.kind
        DispatchQueue.global(qos: .userInitiated).async {
            let fm = FileManager.default
            let tmp = fm.temporaryDirectory.appendingPathComponent("picked", isDirectory: true)
            try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
            var files: [[String: String]] = []
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                // 클라우드(구글 드라이브 · iCloud)에만 있는 파일은 조율된 읽기로 내려받은 뒤 복사한다
                var err: NSError?
                NSFileCoordinator().coordinate(readingItemAt: url, options: [.withoutChanges], error: &err) { src in
                    let dst = tmp.appendingPathComponent(UUID().uuidString + "." + (kind == "zip" ? "zip" : "pdf"))
                    do {
                        try fm.copyItem(at: src, to: dst)
                        files.append(["path": dst.absoluteString, "name": url.lastPathComponent])
                    } catch {
                        CAPLog.print("⚡️ 강단노트: 파일 복사 실패 \(error)")
                    }
                }
                if let err = err { CAPLog.print("⚡️ 강단노트: 파일 읽기 실패 \(err)") }
            }
            call.resolve(["files": files])
        }
    }
}
