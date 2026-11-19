/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Platform / Capabilities
 * --------------------------------------------------------------------------
 * 執行環境能力偵測，結果顯示在狀態列與「環境資訊」對話框。
 * ========================================================================== */

/**
 * 偵測瀏覽器能力。
 * @returns {Record<string, boolean|number|string>}
 */
export function detectCapabilities() {
  return {
    crossOriginIsolated: Boolean(self.crossOriginIsolated),
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    webAssembly: typeof WebAssembly === 'object',
    audioContext: typeof AudioContext === 'function',
    audioWorklet: typeof AudioWorkletNode === 'function',
    webCodecs: typeof AudioEncoder === 'function',
    opfs: Boolean(navigator.storage && navigator.storage.getDirectory),
    fileSystemAccess: typeof window.showSaveFilePicker === 'function',
    serviceWorker: 'serviceWorker' in navigator,
    deviceMemoryGB: navigator.deviceMemory || 0,
    cpuThreads: navigator.hardwareConcurrency || 0,
    protocol: location.protocol
  };
}

/** 能力名稱對照（顯示用） */
export const CAPABILITY_LABELS = {
  crossOriginIsolated: '跨來源隔離（多執行緒必要）',
  sharedArrayBuffer: 'SharedArrayBuffer',
  webAssembly: 'WebAssembly',
  audioContext: 'Web Audio API',
  audioWorklet: 'AudioWorklet',
  webCodecs: 'WebCodecs AudioEncoder',
  opfs: 'OPFS 私有檔案系統',
  fileSystemAccess: '另存新檔對話框',
  serviceWorker: 'Service Worker（離線）',
  deviceMemoryGB: '裝置記憶體（GB，概估）',
  cpuThreads: 'CPU 執行緒',
  protocol: '開啟方式'
};
