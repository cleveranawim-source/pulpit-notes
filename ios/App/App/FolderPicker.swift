import UIKit
import Capacitor
import UniformTypeIdentifiers

/// 강단노트 화면 — Capacitor 기본 화면에 앱 전용 플러그인을 더한다.
class PulpitViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(FolderPickerPlugin())
    }
}

/// 파일 앱 선택 창을 직접 띄워, 마지막으로 원고를 고른 폴더에서 다시 열리게 한다.
/// (웹의 <input type=file> 은 시작 폴더를 정할 수 없다)
/// - 원고(pdf)와 백업(zip)은 폴더를 따로 기억한다.
/// - 원본 자리에서 열어(asCopy: false) 그 폴더를 알아낸 뒤, 파일은 임시 폴더로 복사해 넘긴다.
@objc(FolderPickerPlugin)
public class FolderPickerPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FolderPickerPlugin"
    public let jsName = "FolderPicker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private var kind = "pdf"

    private func folderKey(_ kind: String) -> String { "pn.lastFolder." + kind }

    @objc func pick(_ call: CAPPluginCall) {
        let kind = call.getString("kind") == "zip" ? "zip" : "pdf"
        let multiple = call.getBool("multiple") ?? false
        DispatchQueue.main.async {
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: kind == "zip" ? [.zip] : [.pdf], asCopy: false)
            picker.allowsMultipleSelection = multiple
            picker.delegate = self
            if let s = UserDefaults.standard.string(forKey: self.folderKey(kind)), let dir = URL(string: s) {
                picker.directoryURL = dir
            }
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
        if let first = urls.first {
            UserDefaults.standard.set(first.deletingLastPathComponent().absoluteString, forKey: folderKey(kind))
        }
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
