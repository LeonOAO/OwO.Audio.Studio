# OwO Audio Studio v1.0.0

純瀏覽器、免上傳、多格式音訊編輯與轉換工具。

所有解碼、剪輯、混音與編碼都在本機瀏覽器內完成，檔案不會離開電腦。

---

## 一、快速開始

1. 解壓縮後，雙擊 **`Start.bat`**。
2. 瀏覽器會自動開啟 `http://127.0.0.1:8765/index.html`。
3. 把音訊或影片檔拖曳到視窗中，即可開始編輯。

> 不可以直接雙擊 `index.html`。瀏覽器禁止以 `file://` 載入 ES 模組與 WebAssembly，必須透過 `Start.bat` 提供的本機伺服器開啟。

### 需要的環境

| 項目 | 說明 |
|---|---|
| 瀏覽器 | Chrome／Edge 最新版（建議）；其他瀏覽器若不支援 OPFS，會自動停用自動儲存，不影響編輯 |
| Python | 3.8 以上。可使用**免安裝版**：把 Windows embeddable Python 解壓縮到本資料夾的 `Python\`，使 `Python\python.exe` 存在即可 |
| PowerShell | **不需要** |

`Start.bat` 依序尋找：`Python\python.exe` → `py` 啟動器 → `PATH` 中的 `python`。

---

## 二、安裝 ffmpeg 核心（建議，只需一次）

雙擊 **`FetchEngine.bat`**，會下載 ffmpeg.wasm 核心到 `Engine\ST`（單執行緒）與 `Engine\MT`（多執行緒）。

公司網路若有 SSL 攔截導致下載失敗，可在命令提示字元執行：

```text
FetchEngine.bat --insecure
```

無法連網時，請依 `Launcher\FetchEngine.py` 檔頭列出的網址在其他電腦下載，再手動放入 `Engine` 資料夾。

| 功能 | 未安裝核心 | 已安裝核心 |
|---|---|---|
| 匯入 MP3、AAC/M4A、WAV、FLAC、OGG、Opus | ✔（瀏覽器解碼） | ✔ |
| 匯入 WMA、AMR、AC-3、E-AC-3、DTS、AIFF、CAF、MKA 等 | 視瀏覽器而定 | ✔ |
| 影片抽音（MP4、MKV、MOV、AVI、TS、FLV…） | 部分 | ✔ |
| 多音軌檔案選擇音軌 | ✖ | ✔ |
| 保留原始取樣率 | 僅 WAV | ✔ |
| 匯出 WAV（跟隨專案規格） | ✔（內建編碼器） | ✔ |
| 匯出 MP3、M4A、FLAC、OGG、Opus、AIFF、ALAC、AC-3、WMA… | ✖ | ✔ |
| 內嵌封面、變更輸出取樣率／聲道 | ✖ | ✔ |
| 快速裁切（不重新編碼） | ✖ | ✔ |

透過 `Start.bat` 開啟時頁面會啟用跨來源隔離，有 `Engine\MT` 就自動使用多執行緒核心，速度較快。

---

## 三、核心功能

### 毫秒級裁切

- 所有時間欄位都可以輸入 `00:01:23.456`、`1:23.456`、`83456ms`、`83.456s`、`4005888smp`。
- 也可以輸入相對值，例如 `+250ms`、`-1ms`。
- 每個欄位旁邊有 **−10／−1／+1／+10 毫秒**微調按鈕；在欄位內按 ↑↓ 也可以微調 1 毫秒（Shift 為 10 毫秒）。
- 內部一律以**取樣點**計算。48 kHz 下精度約 0.0208 毫秒，比 1 毫秒更精細。
- 時間顯示單位可以切換為「時:分:秒.毫秒／毫秒／取樣點」。
- 波形可以放大到每個取樣點 20 像素，直接看到每個取樣點。

### 插入空白與靜音

| 操作 | 結果 | 總長度 |
|---|---|---|
| **插入空白**（I／Insert） | 在指定位置插入任意長度的空白，後方內容整段往後推 | 增加 |
| **靜音**（Shift+Delete） | 把選取範圍變成無聲，後方不移動 | 不變 |
| **刪除接合**（Delete） | 刪除選取範圍，後方往前接合 | 減少 |
| **只保留**（K） | 只留下選取範圍 | 等於選取長度 |

「插入空白」對話框提供 1 ms 至 10 秒的常用長度，也可以直接輸入任意長度。插入點在專案結尾之後時，會延長專案總長度。

### 避免爆音

刪除、插入空白、靜音所產生的接點，預設會加上 **3 ms 等功率淡化**，可以在「設定 → 接點淡化」調整，設為 0 即關閉。

勾選上方的「零交越點」後，選取邊界會自動移到 ±5 ms 內最近的零交越點。

### 多軌與片段

- 可以新增多條音軌，每條音軌各有音量、聲相、靜音（M）、獨奏（S）。
- 拖曳片段的**標題列**可以移動片段，也可以拖到其他音軌。
- 拖曳片段的**左右邊緣**可以修剪片段。
- 雙擊片段會選取整個片段的範圍。
- 右側面板可以調整片段的增益、淡入淡出長度與曲線，也可以執行「正規化 −1 dB」。正規化不會修改原始音訊，只調整片段增益。
- 「套用」選項決定編輯操作套用到全部音軌或只套用到目前音軌。

### 非破壞式編輯

所有剪輯都只修改「片段清單」，不會重新編碼，也不會反覆壓縮。只有在匯出時才把結果一次合成並編碼，因此編輯 100 次也不會損失音質。

復原／重做最多保留 200 步。連續拖曳只算一步。

### 自動儲存

專案會自動儲存到瀏覽器（IndexedDB＋OPFS）。重新開啟頁面時會自動還原上次的專案。按「新專案」會清除自動儲存的內容。

---

## 四、匯出

| 模式 | 說明 |
|---|---|
| 完整混音 | 精確到取樣點，套用所有剪輯、淡化與增益，重新編碼輸出 |
| 每條音軌分別輸出 | 每條含片段的音軌各輸出一個檔案，並打包成 ZIP |
| 快速裁切原始檔 | 不重新編碼，直接截取原始檔；速度快、音質不變，但起訖點會對齊 MP3／AAC 的壓縮框架，**不保證毫秒精準**，也不會套用剪輯效果 |

### 支援格式

| 分組 | 格式 |
|---|---|
| 常用 | MP3（CBR／VBR）、M4A（AAC）、WAV（16／24／32-bit Float）、FLAC、OGG Vorbis、Opus |
| 專業／相容 | AAC（ADTS）、AIFF、ALAC、AC-3、WMA、Wave64、CAF |
| 特殊 | WebM Audio、MKA、Ogg FLAC、原始 PCM |

可以設定取樣率、聲道、中繼資料（標題、演出者、專輯等），並為 MP3、M4A、FLAC、ALAC 加入封面圖片。匯出時會自動帶入第一個來源檔的中繼資料。

匯出後，ffmpeg 會重新讀取輸出檔，並在日誌中記錄「預期長度、實際長度、差異毫秒」。

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

## 六、部署到網站

整個資料夾就是靜態網站，不需要建置步驟。

| 平台 | 做法 |
|---|---|
| Cloudflare Pages／Netlify | 直接上傳，`_headers` 已設定跨來源隔離標頭 |
| Nginx／Apache | 在伺服器設定加入 `Cross-Origin-Opener-Policy: same-origin` 與 `Cross-Origin-Embedder-Policy: require-corp` |
| GitHub Pages | 直接上傳；`ServiceWorker.js` 會補上標頭，頁面會自動重新載入一次以啟用 |

`Engine` 資料夾內的核心檔案體積較大（數十 MB），部署前請先執行 `FetchEngine.bat`。

---

## 七、專案結構

```text
OwO Audio Studio/
├─ index.html                 進入頁面
├─ ServiceWorker.js           離線快取＋跨來源隔離標頭
├─ manifest.webmanifest       PWA 設定
├─ _headers                   Cloudflare Pages／Netlify 標頭
├─ Start.bat                  啟動本機伺服器
├─ FetchEngine.bat            下載 ffmpeg 核心
├─ Engine/                    ffmpeg.wasm 核心（ST／MT）
├─ Icons/
├─ Launcher/
│  ├─ Server.py               含 COOP／COEP 標頭的本機伺服器
│  └─ FetchEngine.py          核心下載與驗證
├─ Source/
│  ├─ App/                    Main（進入點）、Editor（應用層中樞）、Styles.css
│  ├─ Domain/                 純函式：Model、TimeCode、Edit、Fades、Analysis
│  ├─ Commands/               History（復原／重做）
│  ├─ Store/                  狀態容器與設定
│  ├─ Engine/
│  │  ├─ Import/              匯入管線（ffmpeg／瀏覽器後備）
│  │  ├─ Peaks/               多層級波形峰值
│  │  ├─ Playback/            播放引擎（Transport）
│  │  ├─ Render/              共用混音核心（播放與匯出共用）
│  │  ├─ Export/              格式定義、內建 WAV 編碼器、ZIP、匯出管線
│  │  └─ FFmpeg/              ffmpeg Worker 代理
│  ├─ Workers/                FFmpeg.worker.js、Peaks.worker.js
│  ├─ Storage/                IndexedDB＋OPFS 自動儲存
│  ├─ Platform/               能力偵測、快捷鍵
│  └─ Components/             Toolbar、TimeBar、TimeInput、Timeline、Inspector、Dialogs、Feedback
└─ Tests/
   ├─ Unit/                   node --test Tests/Unit/*.test.js
   └─ E2E/                    Playwright 端對端驗證
```

### 架構重點

- **時間單位唯一**：專案內部所有時間都是整數取樣點。毫秒只用於顯示與輸入，取整只發生在 `TimeCode.msToSamples`。
- **空白不佔資料**：片段之間沒有被覆蓋的時間就是靜音，插入一小時空白也幾乎不佔記憶體。
- **播放＝匯出**：播放與匯出共用 `Render/Mixer.js`，聽到的就是匯出的結果。
- **領域層可測試**：`Source/Domain` 不依賴瀏覽器 API，可以直接用 Node.js 驗證每個剪輯操作是否精確到取樣點。

---

## 八、測試

```text
node --test Tests/Unit/*.test.js
python Tests/E2E/SmokeTest.py
```

單元測試涵蓋時間解析與格式化、插入空白、刪除接合、靜音、只保留、分割、接點淡化、複製貼上、淡入、片段移動與修剪、零交越點搜尋。

端對端測試會匯入一個 1 kHz 正弦波，在 1.000 秒插入 0.250 秒空白後匯出 WAV，並逐一檢查取樣點，確認第 48000～59999 個取樣點全部為 0。

---

## 九、限制與注意事項

- 解碼後的音訊以 32-bit float 保存在記憶體。10 分鐘 48 kHz 立體聲約 230 MB，建議單一專案不超過 60 分鐘。
- 未安裝 ffmpeg 核心時，瀏覽器後備解碼會把非 WAV 檔案重新取樣到專案取樣率。
- MIDI、MOD／XM／S3M／IT 與無標頭 PCM 的匯入規劃於擴充套件，目前版本會顯示提示訊息。
- ffmpeg 的編碼與解碼無法中途暫停；按「取消」會終止 ffmpeg 背景程序，下次使用時自動重新載入。
- 授權：ffmpeg.wasm 核心為 LGPL／GPL 授權元件，由 `FetchEngine` 另行下載，未內含於本專案程式碼中。
