# -*- coding: utf-8 -*-
"""
==========================================================================
OwO Audio Studio v1.0.0
Tests / E2E / SmokeTest.py
--------------------------------------------------------------------------
端對端驗證（需要 Python 套件 playwright 與 Chromium）：

  1. 啟動 Launcher/Server.py
  2. 開啟頁面，確認跨來源隔離與無主控台錯誤
  3. 匯入產生的 2 秒 48 kHz 立體聲正弦波 WAV
  4. 透過「插入空白」對話框在 1.000 秒插入 0.250 秒
  5. 刪除並接合 0.100～0.200 秒、復原、重做
  6. 以內建編碼器匯出 24-bit WAV
  7. 逐取樣點驗證輸出：長度、空白區全為 0、前後資料連續

用法：python Tests/E2E/SmokeTest.py [--chromium 路徑]
==========================================================================
"""

import argparse
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import wave

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RATE = 48000


def say(*lines):
    for line in lines:
        print(line, flush=True)
        print("", flush=True)


def make_sine(path, seconds=2.0, freq=1000.0):
    """產生 16-bit 立體聲正弦波 WAV。"""
    frames = int(RATE * seconds)
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        data = bytearray()
        for i in range(frames):
            v = int(0.5 * 32767 * math.sin(2 * math.pi * freq * i / RATE))
            data += struct.pack("<hh", v, v)
        w.writeframes(bytes(data))
    return frames


def read_wav24(path):
    """讀取 24-bit WAV，回傳左聲道整數陣列。"""
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 3, "輸出應為 24-bit"
        assert w.getframerate() == RATE, "取樣率應為 48000"
        ch = w.getnchannels()
        raw = w.readframes(w.getnframes())
    left = []
    step = 3 * ch
    for i in range(0, len(raw), step):
        b = raw[i:i + 3]
        v = int.from_bytes(b, "little", signed=True)
        left.append(v)
    return left


def wait_port(port, timeout=15):
    """等待伺服器開始接受連線。"""
    import socket
    end = time.time() + timeout
    while time.time() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.2)
    raise RuntimeError("伺服器未啟動")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chromium", default=None)
    parser.add_argument("--port", type=int, default=8899)
    args = parser.parse_args()

    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "Sine 1k.wav")
    frames = make_sine(src)

    server = subprocess.Popen(
        [sys.executable, os.path.join(ROOT, "Launcher", "Server.py"), "--port", str(args.port), "--no-browser"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_port(args.port)
    errors = []
    missing = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chromium) if args.chromium else p.chromium.launch()
            page = browser.new_page(viewport={"width": 1500, "height": 900}, accept_downloads=True)
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            # 未安裝 ffmpeg 核心時，Engine 偵測的 404 屬正常；其餘 404 視為錯誤
            page.on("response", lambda r: missing.append(r.url) if r.status == 404 else None)
            page.goto(f"http://127.0.0.1:{args.port}/index.html")
            page.wait_for_function("window.OwOAudioStudio && window.OwOAudioStudio.state.engine.status !== 'detecting'")
            page.wait_for_timeout(800)

            isolated = page.evaluate("self.crossOriginIsolated")
            say(f"跨來源隔離：{isolated}")
            assert isolated, "頁面應啟用跨來源隔離"

            # 匯入
            page.set_input_files("input[type=file][multiple]", src)
            page.wait_for_function("window.OwOAudioStudio.length() > 0 && !window.OwOAudioStudio.state.busy.active", timeout=20000)
            length = page.evaluate("window.OwOAudioStudio.length()")
            say(f"匯入後長度：{length}（預期 {frames}）")
            assert length == frames

            # 插入空白對話框：位置 1.000 秒、長度 0.250 秒
            page.evaluate("window.OwOAudioStudio.setPlayhead(48000)")
            page.keyboard.press("i")
            dialog = page.locator("dialog[open]")
            fields = dialog.locator(".TimeField")
            fields.nth(0).fill("00:00:01.000")
            fields.nth(1).fill("250ms")
            dialog.locator("button.Primary").click()
            page.wait_for_timeout(200)
            length = page.evaluate("window.OwOAudioStudio.length()")
            say(f"插入空白後長度：{length}（預期 {frames + 12000}）")
            assert length == frames + 12000

            # 刪除並接合、復原、重做、再復原（最終保持插入空白後的狀態）
            page.evaluate("window.OwOAudioStudio.setSelection(4800, 9600)")
            page.keyboard.press("Delete")
            page.wait_for_timeout(100)
            assert page.evaluate("window.OwOAudioStudio.length()") == frames + 12000 - 4800
            page.keyboard.press("Control+z")
            page.keyboard.press("Control+y")
            page.keyboard.press("Control+z")
            page.wait_for_timeout(100)
            assert page.evaluate("window.OwOAudioStudio.length()") == frames + 12000
            say("刪除並接合／復原／重做：正確")

            # 播放 0.3 秒確認播放引擎可運作
            page.keyboard.press("Space")
            page.wait_for_timeout(400)
            pos = page.evaluate("window.OwOAudioStudio.livePosition()")
            page.keyboard.press("Space")
            say(f"播放位置推進：{pos}")

            # 匯出（停用另存新檔對話框，改走下載）
            page.evaluate("window.showSaveFilePicker = undefined")
            page.evaluate("window.OwOAudioStudio.clearSelection()")
            page.keyboard.press("Control+e")
            dialog = page.locator("dialog[open]")
            dialog.locator("select:has(optgroup)").select_option("wav")
            with page.expect_download() as info:
                dialog.locator("button.Primary").click()
            out = os.path.join(tmp, "out.wav")
            info.value.save_as(out)
            say(f"匯出檔名：{info.value.suggested_filename}")

            page.screenshot(path=os.path.join(ROOT, "Tests", "E2E", "Screenshot.png"))
            browser.close()
    finally:
        server.terminate()

    left = read_wav24(out)
    say(f"輸出取樣點：{len(left)}")
    assert len(left) == frames + 12000
    # 插入點附近含 3 ms 接點淡化（144 取樣點），淡化以外的空白區必須完全為 0
    zero_ok = all(v == 0 for v in left[48000:60000])
    say(f"空白區 48000～59999 全為 0：{zero_ok}")
    assert zero_ok
    expected = int(0.5 * 32767 * math.sin(2 * math.pi * 1000 * 47000 / RATE)) / 32767
    got = left[47000] / 8388607
    say(f"空白前資料一致：{abs(expected - got) < 1e-3}")
    assert abs(expected - got) < 1e-3
    expected_after = int(0.5 * 32767 * math.sin(2 * math.pi * 1000 * 49000 / RATE)) / 32767
    got_after = left[49000 + 12000] / 8388607
    say(f"空白後資料一致：{abs(expected_after - got_after) < 1e-3}")
    assert abs(expected_after - got_after) < 1e-3

    unexpected_404 = [u for u in missing if "/Engine/" not in u]
    say(f"非預期的 404：{unexpected_404 or '無'}")
    assert not unexpected_404
    real_errors = [e for e in errors if "favicon" not in e and "status of 404" not in e]
    say(f"主控台錯誤：{real_errors or '無'}")
    assert not real_errors
    say("✔ 全部通過")


if __name__ == "__main__":
    main()
