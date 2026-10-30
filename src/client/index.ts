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

/* ======================= 配置（localStorage，可静默降级） ======================= */

import { defaults, type BuddyConfig as TbConfig } from '../config.js';
/* ============================= 注入的样式 ============================= */

function tbInjectStyles(): void {
  const pluginId = '@dsh-plugin/dsh-thought-buddy';
  const tagId = `${pluginId}/styles.css`;
  if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return;
  const style = document.createElement('style');
  style.dataset.plugin = pluginId;
  style.dataset.pluginCss = tagId;
  style.textContent = `
[data-thought-buddy] {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-right: 7px;
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

interface TbTypewriter {
  switchWord(): void;
  stop(): void;
}

/**
 * 在 turnStatus 上挂打字机：每次表情切换调用 switchWord()，
 * 先逐字符删除当前文字，停顿后逐字符打出列表中的下一个词（带 "..."）。
 * React 渲染的文本 fiber 的 children 字符串始终不变，因此不会覆盖我们的修改。
 * 返回 { switchWord, stop }；root 卸载时 stop() 由观察器清理。
 */
function tbStartTypewriter(root: Element): TbTypewriter | null {
  let textNode: Text | null = null;
  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      textNode = node as Text;
      break;
    }
  }
  if (textNode === null) return null;

  const DELETE_MS = 40;
  const TYPE_MS = 46;
  const HOLD_MS = 420;
  let timer: number | null = null;
  let wordIndex = -1;

  const pickNext = (): string => {
    if (TB_WORDS.length === 0) return 'Deep diving';
    let next = wordIndex;
    while (next === wordIndex) {
      next = Math.floor(Math.random() * TB_WORDS.length);
    }
    wordIndex = next;
    return TB_WORDS[next];
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTyping = (word: string): void => {
    let i = 0;
    timer = setInterval(() => {
      if (!root.isConnected) {
        clearTimer();
        return;
      }
      i += 1;
      if (i < word.length) {
        textNode.textContent = word.slice(0, i);
      } else {
        textNode.textContent = word + '...';
        clearTimer();
      }
    }, TYPE_MS);
  };

  /** 删除当前文字 → 停顿 → 逐字打出下一个词。 */
  const switchWord = (): void => {
    clearTimer();
    timer = setInterval(() => {
      if (!root.isConnected) {
        clearTimer();
        return;
      }
      const t = textNode.textContent ?? '';
      if (t.length <= 1) {
        clearTimer();
        textNode.textContent = '';
        setTimeout(() => {
          if (!root.isConnected) return;
          startTyping(pickNext());
        }, HOLD_MS);
      } else {
        textNode.textContent = t.slice(0, -1);
      }
    }, DELETE_MS);
  };

  return {
    switchWord,
    stop: clearTimer,
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
  cfg: TbConfig,
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

/**
 * 在 dshLoader.ui 提供的挂载节点里渲染 GrokBot 头像，并联动状态条打字机文字。
 *
 * 放置由 slot 引擎负责（`conversation.status` 锚点声明了 `insert: 'prepend'`），
 * 因此本函数只往 `mount` 里追加内容，不再自己 insertBefore；幂等与自愈也由引擎
 * 保证，原先的 `[data-thought-buddy]` 去重判断随之移除。
 *
 * @param mount 引擎创建的挂载节点（已插入状态条内部最前）。
 * @param host  状态条元素本身——打字机需要它的文本节点。
 */
function tbMountAvatar(mount: Element, host: Element, cfg: TbConfig): TbHandle | null {
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
  const typewriter = tbStartTypewriter(host);
  const handle = tbRunAvatar(engine, cfg, () => typewriter?.switchWord());
  return {
    stop: () => {
      handle.stop();
      typewriter?.stop();
    },
  };
}

/** 在 dshLoader.ui 提供的挂载节点里渲染 emoji 轮播。 */
function tbMountEmoji(mount: Element, cfg: TbConfig): TbHandle | null {
  const span = document.createElement('span');
  span.setAttribute('data-thought-buddy', 'emoji');
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
  mount(
    anchor: string,
    spec: {
      id: string;
      when?: (host: Element) => boolean;
      render: (mount: HTMLElement, host: Element) => (() => void) | void;
    },
  ): () => void;
}

/**
 * 启动：把小表情挂到 dsh-loader 的 `conversation.status` 锚点上。
 *
 * 从「自己维护一套 DOM 注入」改为「向 loader 注册一个 slot」之后，下面这些不再
 * 由本插件实现，而由 `dshLoader.ui` 统一提供：
 *   - MutationObserver 与 requestAnimationFrame 合流节流；
 *   - 宿主选择器（主路径 `[data-conversation-scroll] [role="status"]` 与全文档
 *     兜底路径），现在是 loader 锚点表里的一条，dsh 改 DOM 只需改 loader；
 *   - 每宿主幂等、React 重渲染后的自愈补回、宿主脱离文档时的清理。
 *
 * 本插件只保留两件真正属于自己的判断：状态条文案是否是「Deep diving…」这类，
 * 以及渲染哪种表情。返回值是 loader 给的 disposer。
 */
function tbStart(ui: TbUiApi, cfg: TbConfig): () => void {
  if (!cfg.enabled) return () => {};
  tbInjectStyles();

  return ui.mount('conversation.status', {
    id: 'thought-buddy:buddy',
    // 锚点给出候选状态条；「是不是思考态」仍由本插件按文案判定。
    // 文案随宿主版本而本地化：0.1.0/0.1.1 硬编码英文 "Deep diving..."，
    // 0.1.2 起走 locale（中文界面为「深度求索中...」）——两种都认。
    when: (host) => /diving|深度求索/i.test(host.textContent ?? ''),
    render: (mount, host) => {
      const handle = cfg.mode === 'emoji' ? tbMountEmoji(mount, cfg) : tbMountAvatar(mount, host, cfg);
      return () => handle?.stop();
    },
  });
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
    stop(); stop = tbStart(ui, { ...defaults, ...view.value });
  };
  ctx.effect(() => {
    const off = client.subscribe(() => { void refresh().catch(error => console.error('[thought-buddy] config refresh failed', error)); });
    return () => { disposed = true; off(); stop(); };
  });
  await refresh();
}
