# OwO Audio Studio v1.0.0（GitHub Pages 版）

純瀏覽器、免上傳、多格式音訊編輯與轉換工具。

只用 GitHub 就能架設：不需要 Python、不需要 Node.js、不需要任何伺服器，也不用手動下載 ffmpeg 核心。

所有解碼、剪輯、混音與編碼都在使用者自己的瀏覽器中完成，音訊檔案不會上傳到 GitHub 或任何地方。

---

## 一、架設步驟

### 1. 建立儲存庫

1. 登入 GitHub，點右上角 **＋ → New repository**。
2. Repository name 輸入 `OwO-Audio-Studio`（可自訂）。
3. 選 **Public**。免費帳號只能用公開儲存庫架設 GitHub Pages。
4. 不要勾選「Add a README file」，按 **Create repository**。

### 2. 上傳檔案

1. 在新儲存庫頁面點 **uploading an existing file**。
2. 開啟解壓縮後的 `OwO Audio Studio` 資料夾，**選取資料夾裡面的全部內容**（包含 `.github` 資料夾），一起拖曳到網頁上。
3. 等待上傳完成，按 **Commit changes**。

上傳完成後，儲存庫最上層應該看得到 `.github`、`Source`、`Icons`、`Tests` 資料夾和 `index.html`。`index.html` 必須在最上層，不能多包一層資料夾。

> `.github` 是以句點開頭的資料夾。Windows 檔案總管會正常顯示；若拖曳後沒有出現，請看下方「常見問題」的手動建立方式。

### 3. 開啟 GitHub Pages

1. 到儲存庫的 **Settings → Pages**。
2. **Source** 選 **GitHub Actions**（不是 Deploy from a branch）。
3. 到 **Actions** 頁籤，點左側「部署到 GitHub Pages」，按右邊 **Run workflow → Run workflow**。

約一到兩分鐘後，執行紀錄出現綠色勾勾就完成了。網址為：

```text
https://你的帳號.github.io/OwO-Audio-Studio/
```

之後每次修改並推送到 `main` 分支，都會自動重新部署。

### 4. 確認是否成功

第一次開啟網站時頁面會**自動重新整理一次**，這是正常現象（說明見「技術說明」）。之後確認：

- 右下角狀態列顯示 **🔒 跨來源隔離**
- 左下角顯示 **🟢 ffmpeg 多執行緒核心**

---

## 二、部署流程做了什麼

`.github/workflows/Deploy.yml` 會在 GitHub 的雲端主機上自動執行：

1. 執行單元測試；任何一項失敗就停止，不會發布壞掉的版本。
2. 把網站需要的檔案複製到 `_site`。
3. 從 npm 官方套件庫下載 ffmpeg.wasm 核心：
   - `@ffmpeg/core` → `Engine/ST`（單執行緒）
   - `@ffmpeg/core-mt` → `Engine/MT`（多執行緒）
4. 檢查核心檔案是否為有效的 WebAssembly。
5. 部署到 GitHub Pages。

核心檔案不放在儲存庫裡，所以不會碰到 GitHub 網頁上傳單檔 25 MiB 的限制。要更換核心版本，修改 `Deploy.yml` 裡的 `FFMPEG_CORE_VERSION` 即可。

---

## 三、核心功能

### 毫秒級裁切

- 所有時間欄位都可以輸入 `00:01:23.456`、`1:23.456`、`83456ms`、`83.456s`、`4005888smp`。
- 也可以輸入相對值，例如 `+250ms`、`-1ms`。
- 每個欄位旁有 **−10／−1／+1／+10 毫秒**微調按鈕；在欄位內按 ↑↓ 微調 1 毫秒（Shift 為 10 毫秒）。
- 內部一律以**取樣點**計算。48 kHz 下精度約 0.0208 毫秒。
- 時間顯示單位可切換為「時:分:秒.毫秒／毫秒／取樣點」。
- 波形可以放大到每個取樣點 20 像素。

### 插入空白與靜音

| 操作 | 結果 | 總長度 |
|---|---|---|
| **插入空白**（I／Insert） | 在指定位置插入任意長度的空白，後方內容整段往後推 | 增加 |
| **靜音**（Shift+Delete） | 把選取範圍變成無聲，後方不移動 | 不變 |
| **刪除接合**（Delete） | 刪除選取範圍，後方往前接合 | 減少 |
| **只保留**（K） | 只留下選取範圍 | 等於選取長度 |

刪除、插入空白、靜音的接點預設加上 **3 ms 等功率淡化**避免爆音，可在「設定 → 接點淡化」調整，設為 0 即關閉。勾選「零交越點」後，選取邊界會自動移到 ±5 ms 內最近的零交越點。

### 多軌與片段

- 每條音軌各有音量、聲相、靜音（M）、獨奏（S）。
- 拖曳片段**標題列**移動片段，可拖到其他音軌；拖曳**左右邊緣**修剪片段；雙擊片段選取整段。
- 右側面板可調整片段增益、淡入淡出長度與曲線，或執行「正規化 −1 dB」（只調整增益，不修改原始音訊）。
- 「套用」選項決定編輯操作套用到全部音軌或只套用到目前音軌。

### 非破壞式編輯與自動儲存

- 所有剪輯只修改片段清單，匯出時才一次合成並編碼，編輯多少次都不會損失音質。
- 復原／重做最多 200 步，連續拖曳只算一步。
- 專案自動儲存在使用者自己的瀏覽器（IndexedDB＋OPFS），重新開啟網頁會自動還原。按「新專案」會清除。

---

## 四、匯出

| 模式 | 說明 |
|---|---|
| 完整混音 | 精確到取樣點，套用所有剪輯、淡化與增益，重新編碼輸出 |
| 每條音軌分別輸出 | 每條含片段的音軌各輸出一個檔案，打包成 ZIP |
| 快速裁切原始檔 | 不重新編碼，速度快、音質不變；起訖點會對齊 MP3／AAC 壓縮框架，**不保證毫秒精準**，也不套用剪輯效果 |

| 分組 | 格式 |
|---|---|
| 常用 | MP3（CBR／VBR）、M4A（AAC）、WAV（16／24／32-bit Float）、FLAC、OGG Vorbis、Opus |
| 專業／相容 | AAC（ADTS）、AIFF、ALAC、AC-3、WMA、Wave64、CAF |
| 特殊 | WebM Audio、MKA、Ogg FLAC、原始 PCM |

可設定取樣率、聲道、中繼資料，並為 MP3、M4A、FLAC、ALAC 加入封面。匯出後會在日誌記錄預期長度、實際長度與差異毫秒。

---

## 五、快捷鍵

| 類別 | 按鍵 | 功能 |
|---|---|---|
| 播放 | 空白鍵 | 播放／暫停 |
| | Esc | 停止；再按一次回到選取起點 |
| | L | 循環播放選取範圍 |
| | P | 從選取起點前 1 秒試聽 |
| 播放頭 | ← → | 移動 100 毫秒 |
| | Alt + ← → | 移動 1 毫秒 |
| | Alt + Shift + ← → | 移動 10 毫秒 |
| | Ctrl + ← → | 移動 1 秒 |
| 選取 | [ ／ ] | 以播放頭設定選取起點／終點 |
| | Ctrl + A／Ctrl + D | 全選／取消選取 |
| 剪輯 | S | 在播放頭分割 |
| | Delete | 刪除並接合 |
| | Shift + Delete | 靜音 |
| | I／Insert | 插入空白 |
| | K | 只保留選取 |
| | F／Shift + F | 淡入／淡出 |
| | Ctrl + C／X／V | 複製／剪下／插入貼上 |
| | Ctrl + Shift + V | 覆蓋貼上 |
| 其他 | Ctrl + Z／Ctrl + Y | 復原／重做 |
| | Ctrl + O／Ctrl + E | 匯入／匯出 |
| | ＋／－／0／Z | 放大／縮小／全部／縮放到選取 |
| | Ctrl + 滾輪 | 以游標為中心縮放 |

---

## 六、常見問題

**Actions 頁籤沒有「部署到 GitHub Pages」**

代表 `.github` 資料夾沒有上傳成功。請在儲存庫頁面按 **Add file → Create new file**，檔名輸入 `.github/workflows/Deploy.yml`（輸入斜線會自動建立資料夾），把本機 `.github\workflows\Deploy.yml` 的內容全部貼上，按 **Commit changes**。

**Actions 執行失敗（紅色叉叉）**

點進失敗的執行紀錄，看是哪一個步驟失敗：

- 「執行單元測試」失敗：程式被改壞了，紀錄會列出失敗的測試名稱。
- 「下載 ffmpeg.wasm 核心」失敗：通常是 npm 暫時無法連線，按 **Re-run jobs** 重試。
- 「部署」失敗並提到 Pages：確認 Settings → Pages 的 Source 是 **GitHub Actions**。

**網站顯示 🟡 未找到 ffmpeg 核心**

部署流程沒有成功放入核心，請檢查 Actions 的執行紀錄。這時網站仍可使用瀏覽器解碼常見格式，並匯出 WAV。

**網站顯示 🔓 未隔離（單執行緒）**

重新整理一次頁面。仍未改善時，確認瀏覽器沒有封鎖 Service Worker（例如無痕模式的部分設定）。單執行緒模式功能完整，只是轉檔速度較慢。

**更新後看到的還是舊版**

按 `Ctrl + F5` 強制重新整理。

---

## 七、技術說明

### 為什麼第一次開啟會自動重新整理

ffmpeg 多執行緒核心需要 `SharedArrayBuffer`，瀏覽器只有在網頁回應帶有 `Cross-Origin-Opener-Policy` 與 `Cross-Origin-Embedder-Policy` 標頭時才開放。GitHub Pages 無法自訂標頭，所以由 `ServiceWorker.js` 在瀏覽器端補上；Service Worker 第一次安裝後要重新整理一次才會生效。

### 專案結構

```text
OwO Audio Studio/
├─ .github/workflows/Deploy.yml   自動測試、下載核心、部署到 GitHub Pages
├─ .gitattributes                 統一換行格式
├─ .gitignore
├─ index.html                     進入頁面
├─ ServiceWorker.js               跨來源隔離標頭＋離線快取
├─ manifest.webmanifest           PWA 設定（可安裝成桌面應用程式）
├─ package.json                   單元測試指令
├─ Icons/
├─ Source/
│  ├─ App/                        Main（進入點）、Editor（應用層中樞）、Styles.css
│  ├─ Domain/                     純函式：Model、TimeCode、Edit、Fades、Analysis
│  ├─ Commands/                   History（復原／重做）
│  ├─ Store/                      狀態容器與設定
│  ├─ Engine/
│  │  ├─ Import/                  匯入管線（ffmpeg／瀏覽器後備）
│  │  ├─ Peaks/                   多層級波形峰值
│  │  ├─ Playback/                播放引擎
│  │  ├─ Render/                  共用混音核心（播放與匯出共用）
│  │  ├─ Export/                  格式定義、內建 WAV 編碼器、ZIP、匯出管線
│  │  └─ FFmpeg/                  ffmpeg Worker 代理
│  ├─ Workers/                    FFmpeg.worker.js、Peaks.worker.js
│  ├─ Storage/                    IndexedDB＋OPFS 自動儲存
│  ├─ Platform/                   能力偵測、快捷鍵
│  └─ Components/                 工具列、時間列、時間軸、屬性面板、對話框、回饋元件
└─ Tests/Unit/                    部署前自動執行的單元測試
```

`Engine` 資料夾不在儲存庫中，由部署流程自動產生。

### 架構重點

- **時間單位唯一**：內部所有時間都是整數取樣點，毫秒只用於顯示與輸入。
- **空白不佔資料**：片段之間沒有被覆蓋的時間就是靜音，插入一小時空白也幾乎不佔記憶體。
- **播放＝匯出**：播放與匯出共用 `Render/Mixer.js`，聽到的就是匯出的結果。
- **部署前驗證**：16 項單元測試涵蓋時間解析、所有剪輯操作、WAV 編碼與 ZIP 校驗碼，例如在 1.000 秒插入 0.250 秒空白後，第 48000～59999 個取樣點必須全部為 0。

---

## 八、限制

- 解碼後的音訊以 32-bit float 保存在記憶體。10 分鐘 48 kHz 立體聲約 230 MB，建議單一專案不超過 60 分鐘。
- 未載入 ffmpeg 核心時，瀏覽器後備解碼會把非 WAV 檔案重新取樣到專案取樣率。
- MIDI、MOD／XM／S3M／IT 與無標頭 PCM 目前不支援匯入，匯入時會顯示提示。
- ffmpeg 轉檔無法中途暫停；按「取消」會終止背景程序，下次使用時自動重新載入。
- 授權：ffmpeg.wasm 核心由部署流程從 npm 下載，屬 LGPL／GPL 授權元件，不包含在本專案程式碼中。
