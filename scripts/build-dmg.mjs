import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

const name = 'dwaudio'
const distDir = join(repoRoot, 'dist')
const workDir = join(distDir, name)
const appBundle = join(workDir, `${name}.app`)
const contentsDir = join(appBundle, 'Contents')
const macosDir = join(contentsDir, 'MacOS')
const resourcesDir = join(contentsDir, 'Resources')
const staticOutDir = join(repoRoot, 'out')
const bundleOutDir = join(resourcesDir, 'out')
const swiftDir = join(workDir, 'src')
const swiftFile = join(swiftDir, 'DWAudioApp.swift')
const iconsetDir = join(workDir, 'dwaudio.iconset')
const dmgPath = join(distDir, `${name}.dmg`)
const rwDmgPath = join(workDir, `${name}-rw.dmg`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
  return result
}

function writeSwiftApp() {
  mkdirSync(swiftDir, { recursive: true })
  writeFileSync(swiftFile, String.raw`import Cocoa
import Darwin
import Foundation
import WebKit

final class StaticFileServer {
    private static let listenPort: UInt16 = 37371

    private let root: URL
    private let acceptQueue = DispatchQueue(label: "dwaudio.static-server.accept")
    private let connectionQueue = DispatchQueue(label: "dwaudio.static-server.connections", attributes: .concurrent)
    private var socketFD: Int32 = -1
    private var running = false

    var port: UInt16 {
        Self.listenPort
    }

    init(root: URL) {
        self.root = root
    }

    deinit {
        stop()
    }

    func start() throws {
        socketFD = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else {
            throw socketError("Could not create local server socket.")
        }

        var yes: Int32 = 1
        _ = setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = Self.listenPort.bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bound = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                Darwin.bind(socketFD, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else {
            throw socketError("Could not bind 127.0.0.1:\(Self.listenPort).")
        }

        guard Darwin.listen(socketFD, SOMAXCONN) == 0 else {
            throw socketError("Could not listen on 127.0.0.1:\(Self.listenPort).")
        }

        running = true
        acceptQueue.async { [weak self] in
            self?.acceptLoop()
        }
    }

    private func stop() {
        running = false
        if socketFD >= 0 {
            Darwin.close(socketFD)
            socketFD = -1
        }
    }

    private func acceptLoop() {
        while running {
            let clientFD = Darwin.accept(socketFD, nil, nil)
            if clientFD < 0 {
                if errno == EBADF || errno == EINVAL {
                    break
                }
                continue
            }
            connectionQueue.async { [weak self] in
                self?.handle(clientFD)
            }
        }
    }

    private func handle(_ clientFD: Int32) {
        defer { Darwin.close(clientFD) }

        var buffer = [UInt8](repeating: 0, count: 65536)
        let byteCount = Darwin.read(clientFD, &buffer, buffer.count)
        let request = byteCount > 0 ? String(bytes: buffer[0..<byteCount], encoding: .utf8) ?? "" : ""
        let response = self.response(for: request)

        response.withUnsafeBytes { pointer in
            guard let baseAddress = pointer.baseAddress else {
                return
            }

            var bytesWritten = 0
            while bytesWritten < response.count {
                let result = Darwin.write(clientFD, baseAddress.advanced(by: bytesWritten), response.count - bytesWritten)
                if result <= 0 {
                    break
                }
                bytesWritten += result
            }
        }
    }

    private func socketError(_ message: String) -> NSError {
        NSError(
            domain: "com.donewell.dwaudio.static-server",
            code: Int(errno),
            userInfo: [NSLocalizedDescriptionKey: "\(message) errno=\(errno)"]
        )
    }

    private func response(for request: String) -> Data {
        let firstLine = request.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            return http(status: "405 Method Not Allowed", contentType: "text/plain", body: Data("Method Not Allowed".utf8))
        }

        let rawPath = String(parts[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
        let path = rawPath.removingPercentEncoding ?? rawPath
        let targetURL = resolvedURL(for: path) ?? root.appendingPathComponent("index.html")

        guard let body = try? Data(contentsOf: targetURL) else {
            return http(status: "404 Not Found", contentType: "text/plain", body: Data("Not Found".utf8))
        }

        return http(status: "200 OK", contentType: contentType(for: targetURL.pathExtension), body: parts[0] == "HEAD" ? Data() : body, length: body.count)
    }

    private func normalizedPath(_ path: String) -> String {
        let trimmed = path == "/" ? "index.html" : String(path.drop(while: { $0 == "/" }))
        if trimmed.isEmpty || trimmed.hasSuffix("/") {
            return trimmed + "index.html"
        }
        return trimmed
    }

    private func resolvedURL(for path: String) -> URL? {
        let normalized = normalizedPath(path)
        var candidates = [root.appendingPathComponent(normalized)]

        if !normalized.hasSuffix(".html") {
            candidates.append(root.appendingPathComponent(normalized + ".html"))
        }

        for candidate in candidates {
            guard isSafe(candidate) else {
                continue
            }

            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) else {
                continue
            }

            if isDirectory.boolValue {
                let indexURL = candidate.appendingPathComponent("index.html")
                if isSafe(indexURL), FileManager.default.fileExists(atPath: indexURL.path) {
                    return indexURL
                }
                continue
            }

            return candidate
        }

        return nil
    }

    private func isSafe(_ url: URL) -> Bool {
        let rootPath = root.standardizedFileURL.path
        let targetPath = url.standardizedFileURL.path
        return targetPath == rootPath || targetPath.hasPrefix(rootPath + "/")
    }

    private func contentType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    private func http(status: String, contentType: String, body: Data, length: Int? = nil) -> Data {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(contentType)",
            "Content-Length: \(length ?? body.count)",
            "Cache-Control: no-store",
            "X-Content-Type-Options: nosniff",
            "X-Frame-Options: DENY",
            "Referrer-Policy: strict-origin-when-cross-origin",
            "Permissions-Policy: microphone=(self), camera=(), geolocation=()",
            "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
            "",
        ].joined(separator: "\r\n") + "\r\n"
        var data = Data(headers.utf8)
        data.append(body)
        return data
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow?
    private var server: StaticFileServer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let outURL = Bundle.main.resourceURL?.appendingPathComponent("out") else {
            showFatalError("Could not locate bundled app resources.")
            return
        }

        do {
            let server = StaticFileServer(root: outURL)
            try server.start()
            self.server = server
            createWindow(url: URL(string: "http://127.0.0.1:\(server.port)/")!)
        } catch {
            showFatalError(error.localizedDescription)
        }
    }

    private func createWindow(url: URL) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsAirPlayForMediaPlayback = false
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "dwaudio"
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)

        webView.load(URLRequest(url: url))
    }

    private func showFatalError(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Could not start dwaudio"
            alert.informativeText = message
            alert.runModal()
            NSApp.terminate(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    @available(macOS 12.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        guard
            let serverPort = server?.port,
            type == .microphone,
            origin.protocol == "http",
            origin.host == "127.0.0.1",
            origin.port == serverPort
        else {
            decisionHandler(.deny)
            return
        }

        decisionHandler(.grant)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
`, 'utf8')
}

function writeInfoPlist() {
  writeFileSync(join(contentsDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>dwaudio</string>
  <key>CFBundleExecutable</key>
  <string>dwaudio</string>
  <key>CFBundleIconFile</key>
  <string>dwaudio</string>
  <key>CFBundleIdentifier</key>
  <string>com.donewell.dwaudio.local</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>dwaudio</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${pkg.version}</string>
  <key>CFBundleVersion</key>
  <string>${pkg.version}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.music</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>dwaudio analyzes local microphone input to detect feedback and recommend EQ actions.</string>
</dict>
</plist>
`, 'utf8')
}

function buildIcon() {
  const sourceIcon = join(repoRoot, 'public', 'icon-512.png')
  if (!existsSync(sourceIcon)) return

  rmSync(iconsetDir, { recursive: true, force: true })
  mkdirSync(iconsetDir, { recursive: true })

  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
  ]

  for (const [size, file] of sizes) {
    run('sips', ['-z', String(size), String(size), sourceIcon, '--out', join(iconsetDir, file)])
  }
  run('iconutil', ['-c', 'icns', iconsetDir, '-o', join(resourcesDir, 'dwaudio.icns')])
}

function pruneFinderMetadata(root) {
  if (!existsSync(root)) return

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.name === '.DS_Store') {
      rmSync(entryPath, { force: true })
      continue
    }
    if (entry.isDirectory()) {
      pruneFinderMetadata(entryPath)
    }
  }
}

rmSync(workDir, { recursive: true, force: true })
rmSync(staticOutDir, { recursive: true, force: true })
rmSync(dmgPath, { force: true })
rmSync(rwDmgPath, { force: true })
mkdirSync(macosDir, { recursive: true })
mkdirSync(resourcesDir, { recursive: true })
mkdirSync(distDir, { recursive: true })

console.log('Building static Next export...')
run('pnpm', ['build'], { env: { DWA_STATIC_EXPORT: '1' } })

if (!existsSync(staticOutDir)) {
  throw new Error('Expected Next static export at ./out, but it was not created.')
}

console.log('Bundling static app...')
cpSync(staticOutDir, bundleOutDir, { recursive: true })
pruneFinderMetadata(bundleOutDir)
writeSwiftApp()
writeInfoPlist()
buildIcon()

console.log('Compiling macOS wrapper...')
run('swiftc', [
  '-O',
  '-framework', 'Cocoa',
  '-framework', 'Foundation',
  '-framework', 'Network',
  '-framework', 'WebKit',
  swiftFile,
  '-o', join(macosDir, name),
])

console.log('Signing app ad hoc...')
run('codesign', ['--force', '--deep', '--sign', '-', appBundle])
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle])

console.log('Creating DMG...')
const mountDir = mkdtempSync(join(tmpdir(), 'dwaudio-dmg-'))
const appSizeMb = Number.parseInt(run('du', ['-sm', appBundle], { capture: true }).stdout, 10)
const dmgSizeMb = Math.max(128, appSizeMb + 64)
run('hdiutil', ['create', '-volname', name, '-size', `${dmgSizeMb}m`, '-fs', 'APFS', '-ov', rwDmgPath])
run('hdiutil', ['attach', '-readwrite', '-nobrowse', '-mountpoint', mountDir, rwDmgPath])
try {
  const mountedAppBundle = join(mountDir, `${name}.app`)
  run('ditto', [appBundle, mountedAppBundle])
  run('codesign', ['--force', '--deep', '--sign', '-', mountedAppBundle])
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', mountedAppBundle])
  symlinkSync('/Applications', join(mountDir, 'Applications'))
} finally {
  run('hdiutil', ['detach', mountDir])
  rmSync(mountDir, { recursive: true, force: true })
}
run('hdiutil', ['convert', rwDmgPath, '-format', 'UDZO', '-o', dmgPath])
run('hdiutil', ['verify', dmgPath])

console.log(`DMG ready: ${dmgPath}`)
