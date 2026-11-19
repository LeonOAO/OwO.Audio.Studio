/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Engine / Playback / Transport
 * --------------------------------------------------------------------------
 * 播放引擎：以共用混音核心（Mixer.renderBlock）逐塊產生 PCM，
 * 再用 AudioBufferSourceNode 依取樣點精確地前後銜接排程。
 *
 *   - AudioContext 取樣率＝專案取樣率，避免播放時重新取樣
 *   - 每塊 0.25 秒、預先排程 0.8 秒
 *   - 播放頭位置由 AudioContext.currentTime 對照排程表計算，不靠計時器估算
 *   - 循環播放：到達循環終點時直接接回循環起點
 *   - 專案變更時 invalidate()：清除已排程區塊並從目前位置重新排程
 * ========================================================================== */

import { renderBlock } from '../Render/Mixer.js';
import { projectLength } from '../../Domain/Model.js';

const BLOCK_SECONDS = 0.25;
const LOOKAHEAD_SECONDS = 0.8;
const TICK_MS = 40;

export class Transport {
  /**
   * @param {object} deps
   * @param {() => object} deps.getProject
   * @param {() => object} deps.getBank
   * @param {() => void} deps.onEnded 播放到結尾時呼叫
   */
  constructor({ getProject, getBank, onEnded }) {
    this.getProject = getProject;
    this.getBank = getBank;
    this.onEnded = onEnded;

    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.playing = false;
    this.timer = null;

    /** @type {{ node: AudioBufferSourceNode, when: number, start: number, length: number }[]} */
    this.segments = [];
    this.nextPos = 0;     // 下一塊要渲染的時間軸位置
    this.nextWhen = 0;    // 下一塊的 AudioContext 時間
    this.loop = null;     // { start, end } 或 null
    this.stopAt = 0;      // 非循環時的結束位置
    this.lastPosition = 0;
  }

  /** 建立或重建 AudioContext（取樣率需與專案一致） */
  async ensureContext(sampleRate) {
    if (this.ctx && this.ctx.sampleRate === sampleRate) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    if (this.ctx) await this.ctx.close();
    try {
      this.ctx = new AudioContext({ sampleRate, latencyHint: 'interactive' });
    } catch {
      // 少數瀏覽器不支援指定取樣率，改用預設（播放時會由瀏覽器重新取樣）
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
    }
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /**
   * 開始播放。
   * @param {number} from 起點（取樣點）
   * @param {{ loop?: {start:number,end:number}|null, stopAt?: number|null }} [options]
   */
  async play(from, { loop = null, stopAt = null } = {}) {
    const project = this.getProject();
    await this.ensureContext(project.sampleRate);
    this.clearScheduled();

    this.loop = loop && loop.end > loop.start ? loop : null;
    this.stopAt = stopAt ?? projectLength(project);
    if (!this.loop && from >= this.stopAt) from = 0;
    if (this.loop && (from < this.loop.start || from >= this.loop.end)) from = this.loop.start;

    this.nextPos = Math.max(0, Math.round(from));
    this.nextWhen = this.ctx.currentTime + 0.06;
    this.lastPosition = this.nextPos;
    this.playing = true;

    this.schedule();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** 停止播放，回傳停止時的位置 */
  stop() {
    const pos = this.position();
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.clearScheduled();
    return pos;
  }

  /** 專案內容改變時呼叫：從目前位置重新排程 */
  invalidate() {
    if (!this.playing) return;
    const pos = this.position();
    this.clearScheduled();
    this.nextPos = pos;
    this.nextWhen = this.ctx.currentTime + 0.03;
    this.stopAt = this.loop ? this.stopAt : projectLength(this.getProject());
    this.schedule();
  }

  /** 停止並移除所有已排程節點 */
  clearScheduled() {
    for (const seg of this.segments) {
      try { seg.node.stop(); } catch { /* 尚未開始 */ }
      seg.node.disconnect();
    }
    this.segments = [];
  }

  /** 計時器：補排程、清除已播完區塊、判斷結尾 */
  tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const rate = this.getProject().sampleRate; // 區塊以專案取樣率建立，時長依此計算

    // 移除已播放完畢的區塊（保留最後一塊供定位計算）
    while (this.segments.length > 1 && this.segments[0].when + this.segments[0].length / rate < now) {
      this.segments.shift().node.disconnect();
    }

    this.schedule();

    // 非循環模式：全部播放完畢
    if (!this.loop && this.nextPos >= this.stopAt) {
      const last = this.segments[this.segments.length - 1];
      if (!last || last.when + last.length / rate <= now) {
        this.playing = false;
        clearInterval(this.timer);
        this.lastPosition = this.stopAt;
        this.onEnded();
      }
    }
  }

  /** 排程直到預讀時間滿足 */
  schedule() {
    const project = this.getProject();
    const bank = this.getBank();
    const rate = project.sampleRate;
    const block = Math.max(128, Math.round(BLOCK_SECONDS * project.sampleRate));
    const horizon = this.ctx.currentTime + LOOKAHEAD_SECONDS;

    while (this.nextWhen < horizon) {
      let limit = this.loop ? this.loop.end : this.stopAt;
      if (this.nextPos >= limit) {
        if (!this.loop) return;
        this.nextPos = this.loop.start;
        limit = this.loop.end;
      }
      const length = Math.min(block, limit - this.nextPos);
      if (length <= 0) return;

      const channels = renderBlock(project, bank, this.nextPos, length);
      const buffer = this.ctx.createBuffer(channels.length, length, project.sampleRate);
      channels.forEach((data, c) => buffer.copyToChannel(data, c));

      const node = this.ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.master);
      node.start(this.nextWhen);

      this.segments.push({ node, when: this.nextWhen, start: this.nextPos, length });
      this.nextWhen += length / rate;
      this.nextPos += length;
    }
  }

  /** 目前播放位置（取樣點） */
  position() {
    if (!this.playing || !this.ctx) return this.lastPosition;
    const now = this.ctx.currentTime;
    const rate = this.getProject().sampleRate;
    let found = null;
    for (const seg of this.segments) {
      if (seg.when <= now) found = seg;
      else break;
    }
    if (!found) return this.segments.length ? this.segments[0].start : this.lastPosition;
    const offset = Math.min(found.length, Math.round((now - found.when) * rate));
    this.lastPosition = found.start + offset;
    return this.lastPosition;
  }

  /**
   * 取得目前輸出峰值（音量表用）。
   * @returns {number} 0 ~ 1+
   */
  meter() {
    if (!this.analyser || !this.playing) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }
}
