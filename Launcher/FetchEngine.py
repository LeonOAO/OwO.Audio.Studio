# -*- coding: utf-8 -*-
"""
==========================================================================
OwO Audio Studio v1.0.0
Launcher / FetchEngine.py
--------------------------------------------------------------------------
下載 ffmpeg.wasm 核心到 Engine 資料夾（只需執行一次）。

  Engine/ST/  單執行緒核心：ffmpeg-core.js、ffmpeg-core.wasm
  Engine/MT/  多執行緒核心：ffmpeg-core.js、ffmpeg-core.wasm、ffmpeg-core.worker.js

來源：npm 套件 @ffmpeg/core 與 @ffmpeg/core-mt 的 UMD 版本，
依序嘗試 jsDelivr、unpkg 兩個 CDN。下載完成後會檢查 WebAssembly 檔頭。

無法連網的環境：可在其他電腦下載以下檔案後，手動放到對應資料夾：
  https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js
  https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm
  https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.js
  https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.wasm
  https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.worker.js

用法：
  python Launcher/FetchEngine.py [--version 0.12.6] [--st-only] [--insecure]
==========================================================================
"""

import argparse
import os
import ssl
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "Engine")

MIRRORS = [
    "https://cdn.jsdelivr.net/npm/{pkg}@{ver}/dist/umd/{name}",
    "https://unpkg.com/{pkg}@{ver}/dist/umd/{name}",
]

PACKAGES = {
    "ST": ("@ffmpeg/core", ["ffmpeg-core.js", "ffmpeg-core.wasm"]),
    "MT": ("@ffmpeg/core-mt", ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"]),
}


def say(*lines):
    """依「一行文字、一個空白行」的格式輸出。"""
    for line in lines:
        print(line, flush=True)
        print("", flush=True)


def download(url, target, context):
    """下載單一檔案並顯示進度，成功回傳位元組數。"""
    request = urllib.request.Request(url, headers={"User-Agent": "OwOAudioStudio-FetchEngine/1.0"})
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        total = int(response.headers.get("Content-Length") or 0)
        temp = target + ".part"
        done = 0
        with open(temp, "wb") as out:
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                out.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    print(f"\r    {os.path.basename(target)}  {done / 1048576:6.1f} MB／{total / 1048576:.1f} MB  {pct:3d}%", end="", flush=True)
        print("", flush=True)
        print("", flush=True)
    os.replace(temp, target)
    return done


def verify(path):
    """檢查檔案內容是否合理。"""
    size = os.path.getsize(path)
    if path.endswith(".wasm"):
        with open(path, "rb") as f:
            if f.read(4) != b"\x00asm":
                raise ValueError("不是有效的 WebAssembly 檔案（可能被代理伺服器替換成錯誤頁面）")
        if size < 1024 * 1024:
            raise ValueError("WebAssembly 檔案過小")
    elif path.endswith("ffmpeg-core.js"):
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            if "createFFmpegCore" not in f.read():
                raise ValueError("ffmpeg-core.js 內容不正確（找不到 createFFmpegCore）")


def fetch_variant(variant, version, context):
    """下載一個核心變體（ST 或 MT）。"""
    pkg, files = PACKAGES[variant]
    folder = os.path.join(ENGINE, variant)
    os.makedirs(folder, exist_ok=True)
    say(f"▶ 下載 {pkg}@{version} → Engine/{variant}")

    for name in files:
        target = os.path.join(folder, name)
        last_error = None
        for mirror in MIRRORS:
            url = mirror.format(pkg=pkg, ver=version, name=name)
            try:
                download(url, target, context)
                verify(target)
                last_error = None
                break
            except Exception as error:  # noqa: BLE001 - 逐一嘗試鏡像
                last_error = error
                say(f"    ⚠ {url} 失敗：{error}")
                if os.path.exists(target):
                    os.remove(target)
        if last_error:
            raise RuntimeError(f"{name} 所有來源皆下載失敗")
    say(f"✔ Engine/{variant} 完成")


def main():
    parser = argparse.ArgumentParser(description="下載 ffmpeg.wasm 核心")
    parser.add_argument("--version", default="0.12.6", help="核心版本（預設 0.12.6）")
    parser.add_argument("--st-only", action="store_true", help="只下載單執行緒核心")
    parser.add_argument("--insecure", action="store_true", help="略過 HTTPS 憑證驗證（公司代理伺服器攔截憑證時使用）")
    args = parser.parse_args()

    context = ssl._create_unverified_context() if args.insecure else ssl.create_default_context()  # noqa: S323

    say("────────────────────────────────────────", "OwO Audio Studio v1.0.0｜下載 ffmpeg 核心", "────────────────────────────────────────")

    variants = ["ST"] if args.st_only else ["ST", "MT"]
    failed = []
    for variant in variants:
        try:
            fetch_variant(variant, args.version, context)
        except Exception as error:  # noqa: BLE001
            failed.append(variant)
            say(f"✖ Engine/{variant} 失敗：{error}")

    if failed:
        say(
            "部分核心下載失敗。",
            "若公司網路有 SSL 攔截，可改執行：FetchEngine.bat --insecure",
            "或依 Launcher/FetchEngine.py 檔頭列出的網址手動下載後放入 Engine 資料夾。",
        )
        sys.exit(1)

    say("全部完成，重新整理網頁即可使用 ffmpeg 核心。")


if __name__ == "__main__":
    main()
