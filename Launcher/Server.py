# -*- coding: utf-8 -*-
"""
==========================================================================
OwO Audio Studio v1.0.0
Launcher / Server.py
--------------------------------------------------------------------------
本機免安裝 HTTP 伺服器。

為什麼不用 python -m http.server：
  ffmpeg.wasm 多執行緒核心需要 SharedArrayBuffer，瀏覽器只有在頁面回應
  帶有下列標頭（跨來源隔離）時才會開放：
      Cross-Origin-Opener-Policy: same-origin
      Cross-Origin-Embedder-Policy: require-corp
  內建的 http.server 不會送出這些標頭，因此另外撰寫本伺服器。

特性：
  - 只使用 Python 標準函式庫，可搭配免安裝版（embeddable）Python
  - 只綁定 127.0.0.1，區網其他電腦無法連線
  - 自動尋找可用連接埠並開啟瀏覽器
  - 正確的 .wasm／.js／.webmanifest MIME 類型
  - 不使用 PowerShell

用法：
  python Launcher/Server.py [--port 8765] [--no-browser]
==========================================================================
"""

import argparse
import functools
import http.server
import mimetypes
import os
import socket
import sys
import threading
import webbrowser

# 專案根目錄（本檔案的上一層）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "v1.0.0"


# ------------------------------------------------------------------------
# 輸出工具：每行文字之後接一個空白行
# ------------------------------------------------------------------------
def say(*lines):
    """依「一行文字、一個空白行」的格式輸出。"""
    for line in lines:
        print(line, flush=True)
        print("", flush=True)


# ------------------------------------------------------------------------
# MIME 類型（部分 Windows 登錄檔會把 .js 設成 text/plain，導致模組無法載入）
# ------------------------------------------------------------------------
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/css", ".css")


class IsolatedHandler(http.server.SimpleHTTPRequestHandler):
    """加上跨來源隔離標頭、停用快取的靜態檔案處理器。"""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # 程式檔不快取，確保更新後立即生效；核心檔體積大，允許快取
        if "/Engine/" in self.path:
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只記錄錯誤，避免主控台被大量請求洗版
        if len(args) >= 2 and str(args[1]).startswith(("4", "5")):
            if "favicon" not in str(args[0]):
                say(f"⚠ {self.address_string()} {fmt % args}")


class QuietServer(http.server.ThreadingHTTPServer):
    """瀏覽器中斷連線時不輸出例外追蹤。"""

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def find_port(start):
    """從 start 開始尋找可用連接埠。"""
    for port in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            # 非 Windows 系統允許重用 TIME_WAIT 狀態的連接埠（Windows 的語意不同，不設定）
            if os.name != "nt":
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError("找不到可用的連接埠（已嘗試 50 個）。")


def engine_status():
    """回報 ffmpeg 核心安裝狀態。"""
    st = os.path.isfile(os.path.join(ROOT, "Engine", "ST", "ffmpeg-core.wasm"))
    mt = os.path.isfile(os.path.join(ROOT, "Engine", "MT", "ffmpeg-core.wasm"))
    if mt and st:
        return "ffmpeg 核心：多執行緒＋單執行緒 已安裝"
    if mt:
        return "ffmpeg 核心：多執行緒 已安裝"
    if st:
        return "ffmpeg 核心：單執行緒 已安裝"
    return "ffmpeg 核心：未安裝（可執行 FetchEngine.bat 下載；未安裝時仍可用瀏覽器解碼＋WAV 匯出）"


def main():
    parser = argparse.ArgumentParser(description="OwO Audio Studio 本機伺服器")
    parser.add_argument("--port", type=int, default=8765, help="起始連接埠（預設 8765）")
    parser.add_argument("--no-browser", action="store_true", help="不要自動開啟瀏覽器")
    args = parser.parse_args()

    port = find_port(args.port)
    handler = functools.partial(IsolatedHandler, directory=ROOT)
    server = QuietServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{port}/index.html"

    say(
        "────────────────────────────────────────",
        f"OwO Audio Studio {VERSION}",
        f"網址：{url}",
        engine_status(),
        "所有處理都在瀏覽器內完成，檔案不會上傳。",
        "關閉此視窗或按 Ctrl+C 即可停止伺服器。",
        "────────────────────────────────────────",
    )

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        say("伺服器已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
