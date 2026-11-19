OwO Audio Studio v1.0.0｜Engine 資料夾

此資料夾存放 ffmpeg.wasm 核心。執行上一層的 FetchEngine.bat 會自動下載：

ST\ffmpeg-core.js、ST\ffmpeg-core.wasm                                  單執行緒核心

MT\ffmpeg-core.js、MT\ffmpeg-core.wasm、MT\ffmpeg-core.worker.js        多執行緒核心

未安裝核心時仍可使用：瀏覽器可解碼的格式（MP3、AAC/M4A、WAV、FLAC、OGG、Opus 等）匯入，以及內建 WAV 匯出。

安裝核心後才支援：WMA、AMR、AC-3、DTS、影片抽音、多音軌選擇，以及 MP3、M4A、FLAC、OGG、Opus、AIFF、ALAC、AC-3、WMA 等格式匯出。

無法連網時，請依 Launcher\FetchEngine.py 檔頭列出的網址，在其他電腦下載後放入對應資料夾。
