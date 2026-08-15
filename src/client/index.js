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
 * 本文件是「纯脚本」（无 ESM import/export），由 scripts/build.mjs 与
 * data.js 一起包进 window.__ModuleLoader__ 工厂；data.js 必须先于本文件求值。
 * ========================================================================== */
'use strict';

/* ======================= 配置（localStorage，可静默降级） ======================= */

const TB_NS = 'dsh-thought-buddy';

function tbRead(key, fallback) {
  try {
    const raw = localStorage.getItem(`${TB_NS}.${key}`);
    return raw === null || raw === '' ? fallback : raw;
  } catch {
    return fallback;
  }
}

function tbConfig() {
  const size = Number.parseInt(tbRead('size', '18'), 10);
  return {
    enabled: tbRead('enabled', '1') !== '0',
    // 'avatar' | 'emoji'
    mode: tbRead('mode', 'avatar'),
    size: Number.isFinite(size) && size >= 8 && size <= 64 ? size : 18,
    emojis: tbRead('emojis', '🤿 🫧 🌊 🐙 🔍 🧠 💭')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  };
}

/* ============================= 注入的样式 ============================= */

function tbInjectStyles() {
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

function tbClamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tbFmt(n) {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function tbExpandRadius(values) {
  if (values.length === 0) return ['0', '0', '0', '0'];
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values.slice(0, 4);
}

function tbParseRadiusToken(token, axisSize) {
  const value = String(token).trim();
  if (value.endsWith('%')) {
    const percent = Number.parseFloat(value);
    return ((Number.isFinite(percent) ? percent : 0) / 100) * axisSize;
  }
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 与 geometry.dart 的 parseBorderRadius 等价：支持 1-4 值与 '/' 椭圆语法，并做相邻角钳制。 */
function tbParseRadii(css, width, height) {
  const parts = String(css).split('/');
  const horizontal = tbExpandRadius(
    parts[0].trim().split(/\s+/).filter(Boolean),
  );
  const verticalSource = parts.length > 1 ? parts[1] : parts[0];
  const vertical = tbExpandRadius(
    verticalSource.trim().split(/\s+/).filter(Boolean),
  );
  const radii = [0, 1, 2, 3].map((i) => ({
    rx: tbParseRadiusToken(horizontal[i], width),
    ry: tbParseRadiusToken(vertical[i], height),
  }));
  const clampPair = (a, b, size, horizontalAxis) => {
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
function tbBodyPath(shape) {
  const width = 210 * shape.aspectX;
  const height = 210 * shape.aspectY;
  const left = TB_FACE_CENTER - width / 2;
  const top = TB_FACE_CENTER - height / 2;
  const radii = tbParseRadii(shape.radius, width, height);
  const [tl, tr, br, bl] = radii;
  const arc = (r, x2, y2) =>
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

function tbSquashTransform(scale) {
  if (scale === 1) return null;
  return (
    `translate(${TB_FACE_CENTER} ${TB_FACE_CENTER}) ` +
    `scale(${tbFmt(scale)} 1) ` +
    `translate(${-TB_FACE_CENTER} ${-TB_FACE_CENTER})`
  );
}

/* ============================= 打字机文字 ============================= */

/** 表情切换时状态条文字轮换的候选词（用户提供）。 */
const TB_WORDS = [
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

/**
 * 在 turnStatus 上挂打字机：每次表情切换调用 switchWord()，
 * 先逐字符删除当前文字，停顿后逐字符打出列表中的下一个词（带 "..."）。
 * React 渲染的文本 fiber 的 children 字符串始终不变，因此不会覆盖我们的修改。
 * 返回 { switchWord, stop }；root 卸载时 stop() 由观察器清理。
 */
function tbStartTypewriter(root) {
  let textNode = null;
  for (const node of root.childNodes) {
    if (node.nodeType === 3) {
      textNode = node;
      break;
    }
  }
  if (textNode === null) return null;

  const DELETE_MS = 40;
  const TYPE_MS = 46;
  const HOLD_MS = 420;
  let timer = null;
  let wordIndex = -1;

  const pickNext = () => {
    if (TB_WORDS.length === 0) return 'Deep diving';
    let next = wordIndex;
    while (next === wordIndex) {
      next = Math.floor(Math.random() * TB_WORDS.length);
    }
    wordIndex = next;
    return TB_WORDS[next];
  };

  const clearTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTyping = (word) => {
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
  const switchWord = () => {
    clearTimer();
    timer = setInterval(() => {
      if (!root.isConnected) {
        clearTimer();
        return;
      }
      const t = textNode.textContent;
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

let tbClipSeq = 0;

function tbCentroid(ring) {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return { x: x / ring.length, y: y / ring.length };
}

function tbLerpRings(current, target, amount) {
  return [0, 1].map((eye) =>
    current[eye].map((p, i) => {
      const q = target[eye][i];
      return [
        p[0] + (q[0] - p[0]) * amount,
        p[1] + (q[1] - p[1]) * amount,
      ];
    }),
  );
}

function tbRandInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function tbTheme(dark) {
  return dark
    ? { body: '#6689ea', eye: '#181a15' }
    : { body: '#5b7fe5', eye: '#fffdf7' };
}

function tbBuildSvg(cfg, dark) {
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

  return { svg, body, clipBody, eyeL, eyeR, shape };
}

/**
 * 启动 thinking 状态的头像动画。返回 stop()。
 * 逐帧移植 _GrokBotState._onTick：弹簧表情形变、表情池轮换、320ms 眨眼、
 * 球面转头投影 + 视线游移 + 轻微摆动。每次表情轮换时调用 onExpression()。
 */
function tbRunAvatar(engine, cfg, onExpression) {
  const state = TB_STATES.thinking;
  const pool = state.expressions;
  const reduced =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  let currentIdx = pool[0];
  let current = TB_EXPRESSIONS[currentIdx];
  let target = current;
  let morph = 1;
  let velocity = 0;
  let blinkT = -1;
  let blinkAt =
    state.blinkMin == null
      ? Infinity
      : performance.now() + tbRandInt(state.blinkMin, state.blinkMax);
  let exprAt = performance.now() + tbRandInt(state.expressionMin, state.expressionMax);
  let raf = 0;
  let t0 = 0;
  let last = 0;
  const springFreq = 7;

  const blinkScale = () => {
    if (blinkT < 0) return 1;
    const p = blinkT / 0.32;
    return Math.max(p < 0.42 ? 1 - p / 0.42 : (p - 0.42) / 0.58, 0.04);
  };

  const draw = (rings, turn, gazeX, gazeY) => {
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
      const corrected = rings[i].map((p) => [
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

  const tick = (ts) => {
    if (!engine.root.isConnected) {
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
        blinkAt = now + tbRandInt(state.blinkMin, state.blinkMax);
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

  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  raf = requestAnimationFrame(tick);
  return { stop };
}

/** 在一个 turnStatus 元素上挂载 GrokBot 头像 + 表情联动的打字机文字。 */
function tbMountAvatar(root, cfg) {
  if (root.querySelector('[data-thought-buddy]') !== null) return null;
  const dark =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-color-scheme: dark)').matches;
  const engine = tbBuildSvg(cfg, dark);
  const wrap = document.createElement('span');
  wrap.setAttribute('data-thought-buddy', 'avatar');
  wrap.appendChild(engine.svg);
  root.insertBefore(wrap, root.firstChild);
  engine.root = root;
  const typewriter = tbStartTypewriter(root);
  const handle = tbRunAvatar(engine, cfg, () => typewriter?.switchWord());
  return {
    stop: () => {
      handle.stop();
      typewriter?.stop();
    },
  };
}

/** 在一个 turnStatus 元素上挂载 emoji 轮播。 */
function tbMountEmoji(root, cfg) {
  if (root.querySelector('[data-thought-buddy]') !== null) return null;
  const span = document.createElement('span');
  span.setAttribute('data-thought-buddy', 'emoji');
  span.textContent = cfg.emojis[0] || '🤿';
  root.insertBefore(span, root.firstChild);
  let index = 0;
  const timer = setInterval(() => {
    if (!root.isConnected) {
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

/* ============================= 观察器 ============================= */

/**
 * 启动：监听 DOM，在会话的「Deep diving...」状态条（[data-conversation-scroll]
 * 内的 [role="status"]）前插入小表情。React 重渲染不会触碰我们插入的节点；
 * 万一被清掉，下一帧 mutation 会补回。返回清理函数。
 */
function tbStart() {
  const cfg = tbConfig();
  if (!cfg.enabled) return () => {};
  tbInjectStyles();

  const mounted = new Map(); // statusEl -> handle

  const scan = () => {
    const roots = new Set();
    // 主路径：会话滚动容器内的状态条；辅路径：任意含 "diving" 文案的 status。
    for (const el of document.querySelectorAll(
      '[data-conversation-scroll] [role="status"]',
    )) {
      if (/diving/i.test(el.textContent)) roots.add(el);
    }
    for (const el of document.querySelectorAll('[role="status"]')) {
      if (/diving/i.test(el.textContent)) roots.add(el);
    }
    for (const el of roots) {
      if (mounted.has(el)) continue;
      const handle =
        cfg.mode === 'emoji'
          ? tbMountEmoji(el, cfg)
          : tbMountAvatar(el, cfg);
      if (handle !== null) mounted.set(el, handle);
    }
    for (const [el, handle] of [...mounted]) {
      if (!el.isConnected) {
        handle.stop();
        mounted.delete(el);
      }
    }
  };

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    for (const handle of mounted.values()) handle.stop();
    mounted.clear();
  };
}

/* ========================= 插件入口 ========================= */

// cordis 服务依赖：本插件只用 ctx.effect，不消费任何服务，故为空。
// 注意：这里的 inject 是 cordis 服务名（由 runtime 等提供），
// 与 package.json 的 dsh.client.inject（客户端模块依赖声明）不是一回事。
const inject = [];

function apply(ctx) {
  ctx.effect(() => tbStart());
}
