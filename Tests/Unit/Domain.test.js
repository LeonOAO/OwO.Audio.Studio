/* ==========================================================================
 * OwO Audio Studio v1.0.0
 * Tests / Unit / Domain
 * --------------------------------------------------------------------------
 * 執行方式：node --test Tests/Unit/
 * 驗證時間轉換、所有剪輯操作與混音結果是否精確到取樣點。
 * ========================================================================== */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTime, formatTime, msToSamples, TimeUnit } from '../../Source/Domain/TimeCode.js';
import { createProject, projectLength, validateProject, clipEnd } from '../../Source/Domain/Model.js';
import {
  splitAt, rippleDelete, silenceRange, insertSilence, keepRange,
  copyRange, paste, fadeRange, addSourceWithClip, moveClip, trimClipStart, trimClipEnd, EditError
} from '../../Source/Domain/Edit.js';
import { renderBlock } from '../../Source/Engine/Render/Mixer.js';
import { findZeroCrossing } from '../../Source/Domain/Analysis.js';

const RATE = 48000;

/* ---------- 測試工具：建立一個 2 秒、數值＝索引+1 的單聲道來源 ---------- */
function makeFixture(seconds = 2) {
  const length = RATE * seconds;
  const data = new Float32Array(length);
  for (let i = 0; i < length; i += 1) data[i] = (i % 1000) / 1000 + 0.001; // 永不為 0
  const project0 = { ...createProject({ sampleRate: RATE, channelCount: 1 }) };
  const source = { id: 'src_a', fileName: 'a.wav', length, channelCount: 1, sampleRate: RATE };
  const { project } = addSourceWithClip(project0, { source });
  const bank = { src_a: { channels: [data] } };
  return { project, bank, data, length };
}

function renderAll(project, bank) {
  return renderBlock(project, bank, 0, projectLength(project))[0];
}

/* ------------------------------ TimeCode ------------------------------ */

test('TimeCode：解析各種格式', () => {
  assert.equal(parseTime('00:01:23.456', RATE).samples, msToSamples(83456, RATE));
  assert.equal(parseTime('01:23.456', RATE).samples, msToSamples(83456, RATE));
  assert.equal(parseTime('83456ms', RATE).samples, 4005888);
  assert.equal(parseTime('4005888smp', RATE).samples, 4005888);
  assert.equal(parseTime('1.5s', RATE).samples, 72000);
  assert.deepEqual(parseTime('+250ms', RATE), { samples: 12000, relative: true });
  assert.deepEqual(parseTime('-1ms', RATE), { samples: -48, relative: true });
  assert.equal(parseTime('250', RATE, TimeUnit.Milliseconds).samples, 12000);
  assert.equal(parseTime('abc', RATE), null);
});

test('TimeCode：格式化與進位', () => {
  assert.equal(formatTime(4005888, RATE), '00:01:23.456');
  assert.equal(formatTime(4005888, RATE, TimeUnit.Milliseconds), '83456');
  assert.equal(formatTime(RATE * 60 - 1, RATE), '00:01:00.000');
  assert.equal(formatTime(44100 * 3661.5, 44100), '01:01:01.500');
});

/* ------------------------------ 剪輯操作 ------------------------------ */

test('插入空白：在 1.000 秒插入 0.250 秒，空白區精確為 0', () => {
  const { project, bank, data, length } = makeFixture();
  const next = insertSilence(project, { position: RATE, length: 12000 });
  assert.deepEqual(validateProject(next), []);
  assert.equal(projectLength(next), length + 12000);

  const out = renderAll(next, bank);
  for (let i = 48000; i < 60000; i += 1) assert.equal(out[i], 0, `取樣點 ${i} 應為 0`);
  assert.equal(out[47999], data[47999]);
  assert.equal(out[60000], data[48000]);
  assert.equal(out[out.length - 1], data[length - 1]);
});

test('插入空白：位置在專案結尾之後也能延長總長度', () => {
  const { project, length } = makeFixture();
  const next = insertSilence(project, { position: length + 100, length: 500 });
  assert.equal(projectLength(next), length + 600);
});

test('刪除並接合：長度縮短、接點資料連續', () => {
  const { project, bank, data, length } = makeFixture();
  const next = rippleDelete(project, { start: 1000, end: 3000 });
  assert.deepEqual(validateProject(next), []);
  assert.equal(projectLength(next), length - 2000);
  const out = renderAll(next, bank);
  assert.equal(out[999], data[999]);
  assert.equal(out[1000], data[3000]);
});

test('區段靜音：長度不變、範圍為 0', () => {
  const { project, bank, data, length } = makeFixture();
  const next = silenceRange(project, { start: 1000, end: 3000 });
  assert.equal(projectLength(next), length);
  const out = renderAll(next, bank);
  assert.equal(out[999], data[999]);
  for (let i = 1000; i < 3000; i += 1) assert.equal(out[i], 0);
  assert.equal(out[3000], data[3000]);
});

test('區段靜音：靜音尾端時總長度仍保留', () => {
  const { project, length } = makeFixture();
  const next = silenceRange(project, { start: length - 100, end: length });
  assert.equal(projectLength(next), length);
});

test('只保留範圍', () => {
  const { project, bank, data } = makeFixture();
  const next = keepRange(project, { start: 4800, end: 9600 });
  assert.equal(projectLength(next), 4800);
  const out = renderAll(next, bank);
  assert.equal(out[0], data[4800]);
  assert.equal(out[4799], data[9599]);
});

test('分割：不改變輸出', () => {
  const { project, bank } = makeFixture();
  const next = splitAt(project, { position: 12345 });
  assert.equal(next.tracks[0].clips.length, 2);
  assert.deepEqual(renderAll(next, bank), renderAll(project, bank));
  assert.throws(() => splitAt(next, { position: 0 }), EditError);
});

test('接點淡化：只作用在接點附近', () => {
  const { project, bank, data } = makeFixture();
  const next = rippleDelete(project, { start: 10000, end: 20000, junctionFade: 144 });
  const out = renderAll(next, bank);
  assert.equal(out[9000], data[9000]);
  assert.ok(Math.abs(out[9999]) < Math.abs(data[9999]));
  assert.ok(Math.abs(out[10000]) < Math.abs(data[20000]));
  assert.equal(out[10144], data[20144]);
});

test('複製後插入貼上與覆蓋貼上', () => {
  const { project, bank, data, length } = makeFixture();
  const clip = copyRange(project, { start: 0, end: 1000 });
  const inserted = paste(project, { position: 5000, clipboard: clip, ripple: true });
  assert.deepEqual(validateProject(inserted), []);
  assert.equal(projectLength(inserted), length + 1000);
  const a = renderAll(inserted, bank);
  assert.equal(a[5000], data[0]);
  assert.equal(a[6000], data[5000]);

  const over = paste(project, { position: 5000, clipboard: clip, ripple: false });
  assert.equal(projectLength(over), length);
  const b = renderAll(over, bank);
  assert.equal(b[5000], data[0]);
  assert.equal(b[6000], data[6000]);
});

test('淡入範圍：起點為 0 附近、終點恢復原值', () => {
  const { project, bank, data } = makeFixture();
  const next = fadeRange(project, { start: 0, end: 4800, direction: 'in', curve: 'linear' });
  const out = renderAll(next, bank);
  assert.ok(out[0] < data[0] * 0.01);
  assert.equal(out[4800], data[4800]);
});

test('片段移動與修剪：重疊時拒絕', () => {
  const { project } = makeFixture();
  const split = splitAt(project, { position: 48000 });
  const [left, right] = split.tracks[0].clips;
  assert.throws(() => moveClip(split, { clipId: right.id, timelineStart: 100 }), EditError);
  const moved = moveClip(split, { clipId: right.id, timelineStart: 60000 });
  assert.equal(moved.tracks[0].clips[1].timelineStart, 60000);

  const trimmed = trimClipStart(moved, { clipId: left.id, timelineStart: 1000 });
  const l = trimmed.tracks[0].clips[0];
  assert.equal(l.timelineStart, 1000);
  assert.equal(l.sourceStart, 1000);

  const trimmedEnd = trimClipEnd(trimmed, { clipId: left.id, timelineEnd: 999999 });
  const l2 = trimmedEnd.tracks[0].clips[0];
  assert.equal(clipEnd(l2), 60000, '不可超過下一個片段起點');
});

test('零交越點搜尋', () => {
  const data = new Float32Array(1000);
  for (let i = 0; i < 1000; i += 1) data[i] = Math.sin((i / 100) * Math.PI * 2);
  const zc = findZeroCrossing([data], 140, 30);
  assert.ok(Math.abs(zc - 150) <= 1);
});
