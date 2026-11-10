/* ============================================================================
 * dsh-thought-buddy — 客户端半区
 *
 * 在 DSH Web 会话的「Deep diving...」状态条前，插入一个动态小表情：
 *   - avatar 模式（默认）：移植自 nasawz/GrokBot（BSD-3-Clause）的 GrokBot
 *     动画头像 —— 纯 SVG + requestAnimationFrame，无任何外部依赖。包含
 *     25 种表情的 48 点眼环数据、thinking 状态的表情池与眨眼节奏、弹簧形变、
 *     球面转头投影与视线游移。
 *   - emoji 模式：在可配置的 emoji 列表间轮播，带弹跳入场动画。
 *
 * 源码为纯 ESM；构建（tsdown，tsdown.client.config.mjs）把本文件与 data.ts
 * 打包成 CJS 并包进 window.__ModuleLoader__.load({ id, factory }) 壳，
 * 导出 apply / inject。ESM 模块作用域天然隔离共享 window 全局。
 * ========================================================================== */
import { TB_EXPRESSIONS, TB_SHAPES, TB_STATES } from './data.js';
import type { TbExpression, TbEyeRing, TbPoint, TbShape } from './data.js';

'use strict';

import { defaults, type BuddyConfig as TbConfig } from '../config.js';
/* ============================= 注入的样式 ============================= */

function tbInjectStyles(): () => void {
  const pluginId = '@dsh-plugin/dsh-thought-buddy';
  const tagId = `${pluginId}/styles.css`;
  const style = document.createElement('style');
  style.dataset.plugin = pluginId;
  style.dataset.pluginCss = tagId;
  style.textContent = `
[data-thought-buddy-row] {
  display: inline-flex;
  align-items: center;
  min-inline-size: 0;
  max-inline-size: 100%;
}
[data-thought-buddy-row] .tb-word {
  inline-size: 10em;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-thought-buddy-row] .tb-elapsed,
[role="status"]:has(> [data-thought-buddy-row="legacy"][data-tb-replace-text]) > [class*="_turnStatusClock"] {
  color: var(--dsw-alias-label-tertiary, #777);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
[data-thought-buddy-row] .tb-elapsed { flex: none; }
[data-chat-running] [class*="_runningContent"]:has(> [data-thought-buddy-row="running"]) {
  max-inline-size: 100%;
  min-block-size: calc(28px + var(--dsh-content-font-delta, 0px));
  block-size: auto;
}
[data-chat-running] [class*="_runningContent"]:has(> [data-thought-buddy-row="running"])
  > [class*="_runningIcon"] {
  order: -1;
}
[data-chat-running] [class*="_runningContent"]:has(> [data-tb-animation]) > [class*="_runningIcon"],
[data-chat-running] [class*="_runningContent"]:has(> [data-tb-replace-text]) > [class*="_runningText"] {
  display: none;
}
[data-thought-buddy] {
  display: inline-flex;
  align-items: center;
  flex: none;
}
[data-tb-replace-text] > [data-thought-buddy],
[data-thought-buddy-row="legacy"] > [data-thought-buddy] {
  margin-inline-end: 7px;
}
[data-thought-buddy="avatar"] { animation: tb-bob 1.7s ease-in-out infinite; }
[data-thought-buddy="avatar"] svg { display: block; }
[data-thought-buddy="emoji"] {
  font-size: 15px;
  line-height: 1;
  animation: tb-bob 1.7s ease-in-out infinite;
}
@keyframes tb-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.5px); }
}
@media (prefers-reduced-motion: reduce) {
  [data-thought-buddy] { animation: none; }
}
`;
  document.head.appendChild(style);
  return () => style.remove();
}

/* ========================= 几何（移植自 geometry.dart） ========================= */

const TB_FACE_CENTER = 114.2705;
const TB_VIEWBOX = 259;
const TB_INSET = 15;

interface TbRadius {
  rx: number;
  ry: number;
}

function tbClamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tbFmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function tbExpandRadius(values: string[]): string[] {
  if (values.length === 0) return ['0', '0', '0', '0'];
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values.slice(0, 4);
}

function tbParseRadiusToken(token: string, axisSize: number): number {
  const value = String(token).trim();
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value);
    return ((Number.isFinite(percent) ? percent : 0) / 100) * axisSize;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 与 geometry.dart 的 parseBorderRadius 等价：支持 1-4 值与 '/' 椭圆语法，并做相邻角钳制。 */
function tbParseRadii(css: string, width: number, height: number): TbRadius[] {
  const parts = String(css).split('/');
  const horizontal = tbExpandRadius(
    parts[0].trim().split(/\s+/).filter(Boolean),
  );
  const verticalSource = parts.length > 1 ? parts[1] : parts[0];
  const vertical = tbExpandRadius(
    verticalSource.trim().split(/\s+/).filter(Boolean),
  );
  const radii: TbRadius[] = [0, 1, 2, 3].map((i) => ({
    rx: tbParseRadiusToken(horizontal[i], width),
    ry: tbParseRadiusToken(vertical[i], height),
  }));
  const clampPair = (a: number, b: number, size: number, horizontalAxis: boolean): void => {
    const first = horizontalAxis ? radii[a].rx : radii[a].ry;
    const second = horizontalAxis ? radii[b].rx : radii[b].ry;
    const sum = first + second;
    if (sum <= size || sum <= 0) return;
    const scale = size / sum;
    if (horizontalAxis) {
      radii[a].rx *= scale;
      radii[b].rx *= scale;
    } else {
      radii[a].ry *= scale;
      radii[b].ry *= scale;
    }
  };
  clampPair(0, 1, width, true);
  clampPair(3, 2, width, true);
  clampPair(0, 3, height, false);
  clampPair(1, 2, height, false);
  return radii;
}

/** 形态 → SVG 圆角矩形路径（椭圆角，对应 RRect.fromRectAndCorners）。 */
function tbBodyPath(shape: TbShape): string {
  const width = 210 * shape.aspectX;
  const height = 210 * shape.aspectY;
  const left = TB_FACE_CENTER - width / 2;
  const top = TB_FACE_CENTER - height / 2;
  const radii = tbParseRadii(shape.radius, width, height);
  const [tl, tr, br, bl] = radii;
  const arc = (r: TbRadius, x2: number, y2: number): string =>
    r.rx <= 0 || r.ry <= 0
      ? ` L ${tbFmt(x2)} ${tbFmt(y2)}`
      : ` A ${tbFmt(r.rx)} ${tbFmt(r.ry)} 0 0 1 ${tbFmt(x2)} ${tbFmt(y2)}`;
  let d = `M ${tbFmt(left + tl.rx)} ${tbFmt(top)}`;
  d += ` L ${tbFmt(left + width - tr.rx)} ${tbFmt(top)}`;
  d += arc(tr, left + width, top + tr.ry);
  d += ` L ${tbFmt(left + width)} ${tbFmt(top + height - br.ry)}`;
  d += arc(br, left + width - br.rx, top + height);
  d += ` L ${tbFmt(left + bl.rx)} ${tbFmt(top + height)}`;
  d += arc(bl, left, top + height - bl.ry);
  d += ` L ${tbFmt(left)} ${tbFmt(top + tl.ry)}`;
  d += arc(tl, left + tl.rx, top);
  return d + ' Z';
}

function tbSquashTransform(scale: number): string | null {
  if (scale === 1) return null;
  return (
    `translate(${TB_FACE_CENTER} ${TB_FACE_CENTER}) ` +
    `scale(${tbFmt(scale)} 1) ` +
    `translate(${-TB_FACE_CENTER} ${-TB_FACE_CENTER})`
  );
}

/* ============================= 打字机文字 ============================= */

/** 表情切换时状态条文字轮换的候选词（用户提供）。 */
const TB_WORDS: string[] = [
  'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Brewing',
  'Calculating', 'Cerebrating', 'Churning', 'Coalescing', 'Cogitating',
  'Computing', 'Conjuring', 'Considering', 'Cooking', 'Crafting',
  'Creating', 'Crunching', 'Deliberating', 'Determining', 'Doing',
  'Effecting', 'Finagling', 'Forging', 'Forming', 'Generating',
  'Hatching', 'Herding', 'Honking', 'Hustling', 'Ideating',
  'Inferring', 'Manifesting', 'Marinating', 'Moseying', 'Mulling',
  'Mustering', 'Musing', 'Noodling', 'Percolating', 'Pondering',
  'Processing', 'Puttering', 'Reticulating', 'Ruminating', 'Schlepping',
  'Shucking', 'Simmering', 'Smooshing', 'Spinning', 'Stewing',
  'Synthesizing', 'Thinking', 'Transmuting', 'Vibing', 'Working',
];

function tbCycleWords(label: Text, typewriter: boolean, standalone: boolean) {
  const DELETE_MS = 40;
  const TYPE_MS = 46;
  const HOLD_MS = 420;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cadence = TB_STATES.thinking;
  let wordIndex = TB_WORDS.indexOf('Thinking');
  label.data = TB_WORDS[wordIndex] + '...';

  const stop = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const schedule = (callback: () => void, delay: number): void => {
    timer = setTimeout(() => {
      timer = undefined;
      if (label.isConnected) {
        callback();
      }
    }, delay);
  };

  const switchWord = (): void => {
    stop();
    const next = Math.floor(Math.random() * (TB_WORDS.length - 1));
    wordIndex = next >= wordIndex ? next + 1 : next;
    const word = TB_WORDS[wordIndex];
    const finish = (): void => {
      label.data = word + '...';
      queueNextWord();
    };
    if (!typewriter) {
      finish();
      return;
    }
    let typed = 0;
    const type = (): void => {
      typed += 1;
      if (typed < word.length) {
        label.data = word.slice(0, typed);
        schedule(type, TYPE_MS);
      } else {
        finish();
      }
    };
    const erase = (): void => {
      const remaining = label.data.slice(0, -1);
      label.data = remaining;
      if (remaining) {
        schedule(erase, DELETE_MS);
      } else {
        schedule(type, HOLD_MS);
      }
    };
    schedule(erase, DELETE_MS);
  };

  const queueNextWord = (): void => {
    if (standalone) {
      schedule(switchWord, tbRandInt(cadence.expressionMin, cadence.expressionMax));
    }
  };
  queueNextWord();
  return {
    switchWord,
    stop,
  };
}

/* ============================= 头像引擎 ============================= */

interface TbEngine {
  svg: SVGSVGElement;
  body: SVGPathElement;
  clipBody: SVGPathElement;
  eyeL: SVGPolygonElement;
  eyeR: SVGPolygonElement;
  shape: TbShape;
  /** 挂载后的宿主元素；tbBuildSvg 之后由 tbMountAvatar 填入。 */
  root: Element | null;
}

interface TbHandle {
  stop(): void;
}

let tbClipSeq = 0;

function tbCentroid(ring: TbEyeRing): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return { x: x / ring.length, y: y / ring.length };
}

function tbLerpRings(current: TbExpression, target: TbExpression, amount: number): TbExpression {
  return [0, 1].map((eye): TbEyeRing =>
    current[eye].map((p, i): TbPoint => {
      const q = target[eye][i];
      return [
        p[0] + (q[0] - p[0]) * amount,
        p[1] + (q[1] - p[1]) * amount,
      ];
    }),
  ) as TbExpression;
}

function tbRandInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function tbTheme(dark: boolean): { body: string; eye: string } {
  return dark
    ? { body: '#6689ea', eye: '#181a15' }
    : { body: '#5b7fe5', eye: '#fffdf7' };
}

function tbBuildSvg(cfg: TbConfig, dark: boolean): TbEngine {
  const ns = 'http://www.w3.org/2000/svg';
  const shape = TB_SHAPES.blob;
  const theme = tbTheme(dark);
  const clipId = `tbClip${++tbClipSeq}`;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${TB_VIEWBOX} ${TB_VIEWBOX}`);
  svg.setAttribute('width', String(cfg.size));
  svg.setAttribute('height', String(cfg.size));
  svg.setAttribute('aria-hidden', 'true');

  const root = document.createElementNS(ns, 'g');
  root.setAttribute('transform', `translate(${TB_INSET} ${TB_INSET})`);

  const body = document.createElementNS(ns, 'path');
  body.setAttribute('d', tbBodyPath(shape));
  body.setAttribute('fill', theme.body);

  const clip = document.createElementNS(ns, 'clipPath');
  clip.setAttribute('id', clipId);
  const clipBody = document.createElementNS(ns, 'path');
  clipBody.setAttribute('d', tbBodyPath(shape));
  clip.appendChild(clipBody);

  const eyes = document.createElementNS(ns, 'g');
  eyes.setAttribute('clip-path', `url(#${clipId})`);
  const eyeL = document.createElementNS(ns, 'polygon');
  eyeL.setAttribute('fill', theme.eye);
  const eyeR = document.createElementNS(ns, 'polygon');
  eyeR.setAttribute('fill', theme.eye);
  eyes.appendChild(eyeL);
  eyes.appendChild(eyeR);

  root.appendChild(body);
  root.appendChild(clip);
  root.appendChild(eyes);
  svg.appendChild(root);

  return { svg, body, clipBody, eyeL, eyeR, shape, root: null };
}

/**
 * 启动 thinking 状态的头像动画。返回 stop()。
 * 逐帧移植 _GrokBotState._onTick：弹簧表情形变、表情池轮换、320ms 眨眼、
 * 球面转头投影 + 视线游移 + 轻微摆动。每次表情轮换时调用 onExpression()。
 */
function tbRunAvatar(
  engine: TbEngine,
  onExpression?: () => void,
): { stop(): void } {
  const state = TB_STATES.thinking;
  const pool = state.expressions;
  const reduced =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  let currentIdx = pool[0];
  let current: TbExpression = TB_EXPRESSIONS[currentIdx];
  let target: TbExpression = current;
  let morph = 1;
  let velocity = 0;
  let blinkT = -1;
  // 生成器保证 blinkMin/blinkMax 同为 null 或同为数字。
  let blinkAt =
    state.blinkMin == null
      ? Infinity
      : performance.now() + tbRandInt(state.blinkMin, state.blinkMax!);
  let exprAt = performance.now() + tbRandInt(state.expressionMin, state.expressionMax);
  let raf = 0;
  let t0 = 0;
  let last = 0;
  const springFreq = 7;

  const blinkScale = (): number => {
    if (blinkT < 0) return 1;
    const p = blinkT / 0.32;
    return Math.max(p < 0.42 ? 1 - p / 0.42 : (p - 0.42) / 0.58, 0.04);
  };

  const draw = (rings: TbExpression, turn: number, gazeX: number, gazeY: number): void => {
    const { shape, eyeL, eyeR, body, clipBody } = engine;
    const bodyScale = shape.squashOnTurn ? Math.max(Math.cos(turn), 0.55) : 1;
    const squash = tbSquashTransform(bodyScale);
    if (squash === null) {
      body.removeAttribute('transform');
      clipBody.removeAttribute('transform');
    } else {
      body.setAttribute('transform', squash);
      clipBody.setAttribute('transform', squash);
    }

    const origin = { x: TB_FACE_CENTER + shape.faceX, y: TB_FACE_CENTER + shape.faceY };
    const radius = 105 * Math.min(shape.faceScaleX, shape.faceScaleY);
    const baseScale = shape.eyeScale; // eyeScale=1, emphasis=1, widget eyeScale=1
    const polys = [eyeL, eyeR];

    for (let i = 0; i < 2; i++) {
      const corrected = rings[i].map((p): TbPoint => [
        origin.x + (p[0] - TB_FACE_CENTER) * shape.faceScaleX,
        origin.y + (p[1] - TB_FACE_CENTER) * shape.faceScaleY,
      ]);
      const center = tbCentroid(corrected);

      const offset = center.x - origin.x;
      const baseLongitude = Math.asin(
        tbClamp(offset / Math.max(radius, 1), -1, 1),
      );
      const longitude = baseLongitude + turn;
      const depth = Math.cos(longitude);
      const perspective =
        Math.max(depth, 0.02) / Math.max(Math.cos(baseLongitude), 0.02);
      const scaleX = tbClamp(perspective * baseScale, 0.02, 2.4);
      const scaleY = tbClamp(blinkScale() * baseScale, 0.02, 2.4);

      if (depth > 0.02) {
        const cx = origin.x + radius * Math.sin(longitude) + gazeX;
        const cy = center.y + gazeY;
        polys[i].setAttribute(
          'points',
          corrected
            .map(
              (p) =>
                `${tbFmt(cx + (p[0] - center.x) * scaleX)},${tbFmt(
                  cy + (p[1] - center.y) * scaleY,
                )}`,
            )
            .join(' '),
        );
        polys[i].removeAttribute('style');
      } else {
        polys[i].style.display = 'none';
      }
    }
  };

  const tick = (ts: number): void => {
    if (engine.root === null || !engine.root.isConnected) {
      stop();
      return;
    }
    if (!t0) {
      t0 = ts;
      last = ts;
    }
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    const now = performance.now();
    const t = (ts - t0) / 1000;

    if (Math.abs(morph - 1) >= 0.001 || Math.abs(velocity) >= 0.001) {
      let remaining = dt;
      while (remaining > 0) {
        const step = Math.min(remaining, 1 / 120);
        velocity +=
          (-2 * springFreq * velocity -
            springFreq * springFreq * (morph - 1)) *
          step;
        morph += velocity * step;
        remaining -= step;
      }
      if (Math.abs(morph - 1) < 0.001 && Math.abs(velocity) < 0.001) {
        morph = 1;
        velocity = 0;
        current = target;
      }
    }

    if (pool.length > 1 && now >= exprAt) {
      const alternatives = pool.filter((i) => i !== currentIdx);
      const next =
        alternatives[Math.floor(Math.random() * alternatives.length)];
      current = tbLerpRings(current, target, tbClamp(morph, 0, 1));
      target = TB_EXPRESSIONS[next];
      currentIdx = next;
      morph = 0;
      velocity = 0;
      exprAt = now + tbRandInt(state.expressionMin, state.expressionMax);
      onExpression?.();
    }

    if (blinkT >= 0) {
      blinkT += dt;
      if (blinkT >= 0.32) {
        blinkT = -1;
        // 重新调度下一次眨眼：相对当前时刻 + 随机 3.5–7s（与 Dart 原版
        // _scheduleBlink 的 Timer(_randomDuration(cadence)) 一致）。
        // 能进入此分支说明 blinkMin 非 null，blinkMax 亦然（见生成器不变量）。
        blinkAt = now + tbRandInt(state.blinkMin!, state.blinkMax!);
      }
    } else if (now >= blinkAt && state.blinkMin != null) {
      blinkT = 0;
    }

    const turn = reduced ? 0 : 0.1 * Math.sin(t * 0.9);
    const gazeX = reduced ? 0 : 0.45 * Math.sin(t * 0.53);
    const gazeY = reduced ? 0 : 0.3 * Math.cos(t * 0.41);

    draw(tbLerpRings(current, target, tbClamp(morph, 0, 1)), turn, gazeX, gazeY);
    raf = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  raf = requestAnimationFrame(tick);
  return { stop };
}

function tbMountAvatar(mount: Element, cfg: TbConfig, onExpression?: () => void): TbHandle {
  const dark =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches;
  const engine = tbBuildSvg(cfg, dark);
  const wrap = document.createElement('span');
  wrap.setAttribute('data-thought-buddy', 'avatar');
  wrap.appendChild(engine.svg);
  mount.appendChild(wrap);
  // rAF 循环以挂载节点为存活基准：引擎在卸载或宿主重渲染时移除它，动画随即自停。
  engine.root = mount;
  return tbRunAvatar(engine, onExpression);
}

/** 在 dshLoader.ui 提供的挂载节点里渲染 emoji 轮播。 */
function tbMountEmoji(mount: Element, cfg: TbConfig): TbHandle {
  const span = document.createElement('span');
  span.setAttribute('data-thought-buddy', 'emoji');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = cfg.emojis[0] || '🤿';
  mount.appendChild(span);
  let index = 0;
  const timer = setInterval(() => {
    if (!span.isConnected) {
      clearInterval(timer);
      return;
    }
    if (cfg.emojis.length < 2) return;
    index = (index + 1) % cfg.emojis.length;
    span.textContent = cfg.emojis[index];
    if (typeof span.animate === 'function') {
      span.animate(
        [
          { transform: 'translateY(0) scale(0.5)', opacity: 0 },
          { transform: 'translateY(-3px) scale(1.2)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(0) scale(1)', opacity: 1 },
        ],
        { duration: 340, easing: 'ease-out' },
      );
    }
  }, 1200);
  return { stop: () => clearInterval(timer) };
}

/* ====================== dshLoader.ui slot 注入 ====================== */

/** dshLoader.ui 中本插件用到的最小面（避免为纯脚本引入类型依赖）。 */
interface TbUiApi {
  defineAnchor(
    name: string,
    spec: { describe: string; find: () => Iterable<Element>; insert: 'prepend' },
  ): () => void;
  mount(
    anchor: string,
    spec: {
      id: string;
      when?: (host: Element) => boolean;
      render: (mount: HTMLElement, host: Element) => (() => void) | void;
    },
  ): () => void;
}

const TB_RUNNING_ANCHOR = 'thought-buddy.running';
const TB_RUNNING_LABEL = ':scope > [class*="_runningText"]';
const TB_LEGACY_LABEL = /^(?:Deep diving|深度求索中)/i;

function tbLegacyLabel(host: Element): Text | undefined {
  return [...host.childNodes].find(
    (node): node is Text => node.nodeType === 3 && TB_LEGACY_LABEL.test(node.textContent?.trim() ?? ''),
  );
}

function tbMountBuddy(mount: HTMLElement, cfg: TbConfig, kind: 'running' | 'legacy'): () => void {
  mount.setAttribute('data-thought-buddy-row', kind);
  const animateAvatar = cfg.enabled && cfg.mode === 'avatar';
  const wordText = cfg.replaceText ? document.createTextNode('') : undefined;
  const words = wordText && tbCycleWords(wordText, cfg.typewriter, !animateAvatar);
  let animation: TbHandle | undefined;
  if (cfg.enabled) {
    mount.setAttribute('data-tb-animation', '');
    animation = animateAvatar ? tbMountAvatar(mount, cfg, words?.switchWord) : tbMountEmoji(mount, cfg);
  }

  if (wordText) {
    mount.setAttribute('data-tb-replace-text', '');
    const word = document.createElement('span');
    word.className = 'tb-word';
    if (kind === 'running') {
      word.setAttribute('aria-hidden', 'true');
    }
    word.appendChild(wordText);
    mount.appendChild(word);
  }
  return () => {
    animation?.stop();
    words?.stop();
  };
}

function tbMountRunning(mount: HTMLElement, host: Element, cfg: TbConfig): () => void {
  const stop = tbMountBuddy(mount, cfg, 'running');
  if (!cfg.replaceText) {
    return stop;
  }
  const elapsed = document.createElement('span');
  elapsed.className = 'tb-elapsed';
  const elapsedText = document.createTextNode('');
  elapsed.appendChild(elapsedText);
  mount.appendChild(elapsed);

  let label: Element | null | undefined;
  const syncElapsed = (): void => {
    const current = host.querySelector(TB_RUNNING_LABEL);
    if (current !== label) {
      label = current;
      observer.disconnect();
      observer.observe(host, { childList: true });
      if (label) {
        observer.observe(label, { childList: true, characterData: true, subtree: true });
      }
    }
    const text = label?.textContent ?? '';
    const duration = text.match(/\d+\s*\p{L}+(?:\s*\d+\s*\p{L}+)*/u)?.[0];
    const prefix = text.includes('用时') ? '用时 ' : /^Deep diving for /i.test(text) ? 'for ' : '';
    const next = duration ? prefix + duration : '';
    if (elapsedText.data !== next) {
      elapsedText.data = next;
    }
  };
  const observer = new MutationObserver(syncElapsed);
  syncElapsed();
  return () => {
    observer.disconnect();
    stop();
  };
}

function tbStart(ui: TbUiApi, cfg: TbConfig): () => void {
  if (!cfg.enabled && !cfg.replaceText) {
    return () => {};
  }
  const removeStyles = tbInjectStyles();
  const removeAnchor = ui.defineAnchor(TB_RUNNING_ANCHOR, {
    describe: '对话中可见的运行状态条',
    find: () => document.querySelectorAll('[data-chat-running]:not([data-holding]) > [class*="_runningContent"]'),
    insert: 'prepend',
  });
  ui.mount(TB_RUNNING_ANCHOR, {
    id: 'thought-buddy:running',
    render: (mount, host) => tbMountRunning(mount, host, cfg),
  });

  const stopLegacy = ui.mount('conversation.status', {
    id: 'thought-buddy:buddy',
    when: (host) => !host.closest('[data-chat-running]') &&
      !host.nextElementSibling?.hasAttribute('data-turn-process') && Boolean(tbLegacyLabel(host)),
    render: (mount, host) => {
      const label = tbLegacyLabel(host);
      if (!label) {
        return;
      }
      const stop = tbMountBuddy(mount, cfg, 'legacy');
      if (!cfg.replaceText) {
        return stop;
      }
      let original = label.data;
      label.data = '';
      const observer = new MutationObserver(() => {
        if (label.data) {
          original = label.data;
          label.data = '';
        }
      });
      observer.observe(label, { characterData: true });
      return () => {
        observer.disconnect();
        stop();
        if (label.parentNode === host && label.data === '') {
          label.data = original;
        }
      };
    },
  });
  return () => {
    stopLegacy();
    removeAnchor();
    removeStyles();
  };
}

/* ========================= 插件入口 ========================= */

/**
 * cordis 服务依赖：`dshLoaderUi` 由 @dsh-plugin/dsh-loader 的浏览器半区
 * `ctx.provide('dshLoaderUi', ui)` 提供。声明它有两个作用：cordis 保证 loader
 * 先激活（`dsh.client.immediately` 只保证工厂已注册，不保证 apply 已跑），并且
 * loader 缺席时本插件不会激活，而不是崩在 undefined 上。
 *
 * 注意：这里的 inject 是 cordis 服务名，与 package.json 的 dsh.client.inject
 * （客户端模块依赖声明，用包名）不是一回事。
 */
const inject: unknown[] = ['dshLoaderUi'];

/** 客户端 cordis Context 的最小结构。 */
interface TbClientContext {
  effect(callback: () => () => void): unknown;
  dshLoaderUi?: TbUiApi;
  get?(name: string): unknown;
}

export { inject };

export async function apply(ctx: TbClientContext) {
  const ui = ctx.dshLoaderUi ?? (ctx.get?.('dshLoaderUi') as TbUiApi | undefined);
  if (!ui) return;
  const client = (window as unknown as { __dshLoader__: { config: {
    read(id: string): Promise<{ value: TbConfig }>;
    subscribe(listener: () => void): () => void;
  } } }).__dshLoader__.config;
  let disposed = false, revision = 0, stop = () => {};
  const refresh = async () => {
    const generation = ++revision;
    const view = await client.read('dsh-thought-buddy');
    if (disposed || generation !== revision) return;
    const { value } = view;
    const replaceText = value.replaceText ?? value.enabled ?? defaults.replaceText;
    stop(); stop = tbStart(ui, { ...defaults, ...value, replaceText });
  };
  ctx.effect(() => {
    const off = client.subscribe(() => { void refresh().catch(error => console.error('[thought-buddy] config refresh failed', error)); });
    return () => { disposed = true; off(); stop(); };
  });
  await refresh();
}
