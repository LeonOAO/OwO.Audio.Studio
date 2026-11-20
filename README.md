# 🎧✨ OwO Audio Studio (OwO 音訊工作室)

![OwO Audio Studio 編輯畫面](Screenshots/OwO_Showcase.png)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![部署到 GitHub Pages](https://github.com/LeonOAO/OwO.Audio.Studio/actions/workflows/Deploy.yml/badge.svg)](https://github.com/LeonOAO/OwO.Audio.Studio/actions/workflows/Deploy.yml)

**OwO Audio Studio** 是一款完全在瀏覽器中執行的音訊編輯與轉檔工具。支援毫秒級裁切、在任意時間點插入空白、多軌剪輯，以及 MP3、M4A、WAV、FLAC、Opus 等多種格式的匯入與匯出。所有處理都在您自己的電腦上完成，**音訊檔案不會上傳到任何伺服器**。

🌐 **立即使用：<https://leonoao.github.io/OwO.Audio.Studio/>**

## 🌟 核心功能說明 (Features)

### ✂️ 毫秒級精準裁切 (Millisecond Trimming)

以取樣點為單位計算，裁切位置比 1 毫秒更精細：

- **直接輸入時間**：支援 `00:01:23.456`、`1:23.456`、`83456ms`、`83.456s`、`4005888smp` 等格式。
- **相對調整**：輸入 `+250ms`、`-1ms` 即可從目前位置前後移動。
- **微調按鈕**：每個時間欄位旁都有 **−10／−1／+1／+10 毫秒** 按鈕；在欄位內按 ↑↓ 也能微調 1 毫秒（按住 Shift 為 10 毫秒）。
- **取樣點級放大**：波形可放大到看見每一個取樣點，48 kHz 下精度約 0.0208 毫秒。

### ▢ 插入空白與靜音 (Insert Silence & Mute)

在指定時間點加入任意長度的空白，或讓某一段變安靜：

| 操作 | 結果 | 總長度 |
|---|---|---|
| **插入空白**（I） | 在指定位置插入空白，後方內容整段往後推 | 增加 |
| **靜音**（Shift + Delete） | 把選取範圍變成無聲，後方不移動 | 不變 |
| **刪除接合**（Delete） | 刪除選取範圍，後方往前接合 | 減少 |
| **只保留**（K） | 只留下選取範圍 | 等於選取長度 |

- **常用長度快速鍵**：插入空白對話框提供 1 毫秒到 10 秒的常用長度。
- **防爆音處理**：接點預設加上 3 毫秒等功率淡化，也可自動對齊零交越點。

### 🎚️ 多軌剪輯 (Multi-track Editing)

像專業音訊軟體一樣排列與調整多段音訊：

- **音軌控制**：每條音軌都有音量、聲相、靜音（M）與獨奏（S）。
- **片段操作**：拖曳標題列移動片段（可跨音軌），拖曳左右邊緣修剪長度，雙擊選取整段。
- **淡入淡出**：可設定長度，並選擇等功率、線性或指數曲線。
- **正規化**：一鍵將片段峰值調整到 −1 dBFS。
- **複製貼上**：支援插入貼上（後方內容往後推）與覆蓋貼上（長度不變）。

### 🔄 多格式匯入與匯出 (Format Conversion)

| 類型 | 支援格式 |
|---|---|
| **匯入音訊** | MP3、AAC、M4A、WAV、FLAC、OGG、Opus、AIFF、WMA、AMR、AC-3、DTS、CAF、MKA 等 |
| **影片抽音** | MP4、MKV、MOV、AVI、WebM、TS、FLV、3GP、WMV 等 |
| **常用匯出** | MP3（CBR／VBR）、M4A（AAC）、WAV（16／24／32-bit）、FLAC、OGG Vorbis、Opus |
| **專業匯出** | AAC（ADTS）、AIFF、ALAC、AC-3、WMA、Wave64、CAF、WebM、MKA |

- **中繼資料**：可編輯標題、演出者、專輯等資訊，並為 MP3、M4A、FLAC 加入封面圖片。
- **分軌輸出**：每條音軌各輸出一個檔案，自動打包成 ZIP。
- **快速裁切**：不重新編碼，直接截取原始檔，速度快且音質不變。

### 💾 非破壞式編輯與自動儲存 (Non-destructive Editing)

- 所有剪輯只記錄操作，匯出時才一次合成，**編輯再多次也不會損失音質**。
- 復原／重做最多 200 步。
- 專案自動儲存在瀏覽器中，關閉網頁後重新開啟會自動還原。

### 📋 執行紀錄 (Execution Logs)

- 在畫面下方查看匯入、剪輯與匯出的詳細過程。
- 匯出後會自動驗證檔案長度，並記錄預期與實際長度的差異。
- 遇到問題時，可按「複製」提供協助檢查。

## 🛠️ 使用說明 (Getting Started)

### 🌐 直接線上使用 (Use Online)

不需要安裝任何軟體，用瀏覽器開啟即可：

- 開啟 **<https://leonoao.github.io/OwO.Audio.Studio/>**。
- 第一次開啟時頁面會**自動重新整理一次**，這是正常現象。
- 把音訊或影片檔拖曳到視窗中，即可開始編輯。
- 編輯完成後按 **💾 匯出**，選擇格式並儲存。

**建議使用 Chrome 或 Edge 最新版。** 開啟後請確認畫面底部顯示 **🔒 跨來源隔離** 與 **🟢 ffmpeg 多執行緒核心**。

### 🚀 部署自己的版本 (Deploy Your Own)

只需要 GitHub 帳號，不需要 Python、Node.js 或任何伺服器：

- 點擊本頁面右上角的 **Fork**，複製一份到您的帳號。
- 到您的儲存庫 **Settings → Pages**，將 **Source** 設為 **GitHub Actions**。
- 到 **Actions** 頁籤，選擇 **「部署到 GitHub Pages」**，按 **Run workflow**。
- 等待出現綠色勾號，網站網址為 `https://您的帳號.github.io/OwO.Audio.Studio/`。

**部署流程會自動完成：** 執行單元測試 → 從 npm 下載 ffmpeg.wasm 核心 → 驗證核心檔案 → 發布網站。之後每次推送到 `main` 分支都會自動重新部署。

### 💻 開發者本機測試 (Local Development)

- **取得原始碼**：透過 Git Clone 下載，或下載 ZIP 解壓縮。
- **執行單元測試**：安裝 [Node.js](https://nodejs.org/) 後，執行 `node --test Tests/Unit/*.test.js`。
- **專案結構**：不需要任何建置步驟，所有程式都是原生 JavaScript 模組，位於 `Source` 資料夾。

## ⌨️ 常用快捷鍵 (Keyboard Shortcuts)

| 按鍵 | 功能 | 按鍵 | 功能 |
|---|---|---|---|
| 空白鍵 | 播放／暫停 | S | 在播放頭分割 |
| Alt + ← → | 播放頭移動 1 毫秒 | Delete | 刪除並接合 |
| ← → | 播放頭移動 100 毫秒 | Shift + Delete | 靜音 |
| [ ／ ] | 設定選取起點／終點 | I | 插入空白 |
| L | 循環播放選取範圍 | F／Shift + F | 淡入／淡出 |
| Ctrl + Z／Y | 復原／重做 | Ctrl + E | 匯出 |

完整快捷鍵請在網站中按 **?** 查看。

## 🚨 常見問題排解 (Troubleshooting)

### 1. 畫面顯示「🟡 未找到 ffmpeg 核心」

網站上缺少 ffmpeg 核心檔案，通常是部署流程沒有成功完成：

- 確認 **Settings → Pages** 的 Source 是 **GitHub Actions**，而不是 Deploy from a branch。
- 到 **Actions** 頁籤，確認「部署到 GitHub Pages」最近一次執行顯示綠色勾號。
- 開啟 `https://您的帳號.github.io/OwO.Audio.Studio/Engine/ST/ffmpeg-core.js`，若顯示 404 代表核心尚未部署。

在核心部署完成前，仍可使用瀏覽器解碼常見格式、進行所有剪輯操作，並匯出 WAV。

### 2. 畫面顯示「🔓 未隔離（單執行緒）」

GitHub Pages 無法自訂伺服器標頭，因此由 Service Worker 在瀏覽器端補上：

- 重新整理一次頁面，通常即可啟用。
- 確認瀏覽器沒有封鎖 Service Worker（部分無痕模式會停用）。
- 單執行緒模式功能完整，只是轉檔速度較慢。

### 3. Actions 執行失敗（紅色叉叉）

點進失敗的執行紀錄，查看是哪一個步驟失敗：

- **執行單元測試**：程式碼有錯誤，紀錄會列出失敗的測試名稱。
- **下載 ffmpeg.wasm 核心**：通常是 npm 暫時無法連線，按 **Re-run jobs** 重試。
- **部署**：確認 Pages 的 Source 設定為 GitHub Actions。

### 4. 更新後畫面還是舊版

按 **Ctrl + F5** 強制重新整理，清除瀏覽器快取。

### 5. 匯入大型檔案時瀏覽器變慢

解碼後的音訊會暫存在記憶體中，10 分鐘的 48 kHz 立體聲約需 230 MB。建議單一專案不超過 60 分鐘，並關閉其他佔用記憶體的分頁。

## 🔒 隱私與安全說明 (Privacy)

本工具的設計原則是**所有資料都留在您的電腦上**：

- **不上傳檔案**：音訊的解碼、剪輯、混音與編碼，全部在瀏覽器中以 WebAssembly 執行。
- **本機儲存**：專案自動儲存在瀏覽器的 IndexedDB 與私有檔案系統（OPFS），只有您的瀏覽器能讀取。
- **無追蹤**：不使用任何分析工具、廣告或第三方追蹤程式。
- **清除資料**：按 **🆕 新專案** 即可清除自動儲存的內容。

**網站在第一次載入後可離線使用；ffmpeg 核心只會從本網站下載，不會連線到其他伺服器。**

## 🧩 技術架構 (Architecture)

- **時間單位統一**：內部所有時間都以整數取樣點計算，毫秒只用於顯示與輸入。
- **空白不佔空間**：片段之間沒有內容的時間就是靜音，插入一小時空白也幾乎不佔記憶體。
- **播放即匯出**：播放與匯出共用同一套混音程式，聽到的就是匯出的結果。
- **部署前驗證**：16 項單元測試涵蓋時間解析、所有剪輯操作、WAV 編碼與 ZIP 校驗。

| 技術 | 用途 |
|---|---|
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | 多格式解碼與編碼 |
| Web Audio API | 即時播放與音量表 |
| Canvas | 波形與時間軸繪製 |
| IndexedDB／OPFS | 專案自動儲存 |
| Service Worker | 跨來源隔離與離線快取 |
| GitHub Actions | 自動測試與部署 |

## 🙏 致謝與參考 (Acknowledgements)

### 📦 使用的開源元件 (Open Source Components)

以下元件會在部署時一併發布到網站上：

- **[ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)**：部署流程從 npm 下載 `@ffmpeg/core` 與 `@ffmpeg/core-mt`，負責多格式解碼與編碼。
- **FFmpeg**：ffmpeg.wasm 的底層，編譯成 WebAssembly 後在瀏覽器中執行。

### 💡 設計參考 (Design References)

以下專案在功能規劃與介面設計上提供了參考。**本專案沒有複製這些專案的程式碼**，所有程式都是另外撰寫的：

| 專案 | 參考內容 |
|---|---|
| **AudioCraft Studio** | 毫秒時間尺、插入空白功能 |
| **WaveForge** | 片段式剪輯、區段靜音、零交越點吸附、復原機制 |
| **SoundCraft Studio** | 以時間碼輸入起點與終點的介面 |
| **audio-editor** | 純靜態、免建置的部署方式 |
| **AudioSlicer Pro** | Web Audio API 與 ffmpeg.wasm 雙引擎、將核心放在網站本地 |
| **Waveform Playlist** | 多軌時間軸與片段拖曳 |
| **coi-serviceworker** | 用 Service Worker 補上跨來源隔離標頭的作法 |

感謝這些開源專案的作者分享他們的成果。

## 📄 授權條款 (License)

此專案採用 **GNU General Public License v3.0 (GPLv3)** 授權條款。
詳情請參閱專案根目錄下的 [LICENSE](LICENSE) 檔案。

本專案部署時使用的 [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) 核心為獨立元件，依其各自的授權條款發布。

*Built with ❤️ for better audio editing.*
