#!/usr/bin/env node
/**
 * verify.mjs — 无浏览器执行真实构建产物 lib/client.js，验证：
 *   1) 工厂契约（load 包装可剥离，apply/inject 可调用）
 *   2) 在模拟的 turnStatus 元素上挂载出正确的 SVG：身体路径含 4 段椭圆角弧线、
 *      两只 48 点眼睛、clipPath、主题填充色
 *   3) 推进几帧 rAF 后，多边形点坐标全部有限且在 viewBox 内
 *   4) 状态条移除后动画自停
 *   5) emoji 模式挂载
 *   6) 眨眼节奏：用可控时钟模拟 ~22s，眨眼事件间隔 ≥ 3.4s（回归：修复了
 *      眨眼结束后 blinkAt 用了毫秒小数值导致连续眨眼的 bug）
 *
 * 用法：node test/verify.mjs
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/* ---------- 剥离 loader 包装，只取工厂内部代码 ---------- */
const intro = 'var exports = module.exports;\n'
const footer = 'exports.apply = apply;'
const start = bundle.indexOf(intro) + intro.length
const end = bundle.indexOf(footer)
if (start < 0 || end < 0) throw new Error('cannot unwrap bundle')
const inner = bundle.slice(start, end)

/* ---------- 最小 DOM / 浏览器桩 ---------- */
class FakeNode {
  constructor(tag, ns) {
    this.tagName = tag
    this.ns = ns
    this.attrs = {}
    this.children = []
    this.childNodes = []
    this.style = {}
    this.parentNode = null
    this.isConnected = true
    this.textContent = ''
    this.dataset = {}
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] }
  removeAttribute(k) { delete this.attrs[k] }
  appendChild(c) { c.parentNode = this; this.children.push(c); this.childNodes.push(c); return c }
  insertBefore(c, ref) {
    c.parentNode = this
    const i = ref ? this.children.indexOf(ref) : -1
    if (i >= 0) this.children.splice(i, 0, c)
    else this.children.unshift(c)
    this.childNodes = [c, ...this.childNodes.filter((n) => n !== c)]
    return c
  }
  querySelector() { return null }
}

function createHarness({ now = () => Date.now() } = {}) {
  const rafQueue = []
  let rafId = 0
  // 可控定时器：setInterval/setTimeout 收集到这里，测试手动执行
  const timers = new Map()
  let timerSeq = 0
  const fakeRoot = new FakeNode('div')
  fakeRoot.textContent = 'Deep diving...'
  // 模拟 React 渲染的文本节点（打字机遍历 childNodes 找 nodeType === 3）
  const textNode = { nodeType: 3, textContent: 'Deep diving...' }
  fakeRoot.childNodes.push(textNode)

  const context = {
    console,
    window: {},
    document: {
      createElementNS: (ns, tag) => new FakeNode(tag, ns),
      createElement: (tag) => new FakeNode(tag),
      head: new FakeNode('head'),
      documentElement: new FakeNode('html'),
      querySelector: () => null,
      querySelectorAll: (sel) => (sel.includes('status') ? [fakeRoot] : []),
    },
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false }),
    performance: { now },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return ++rafId },
    cancelAnimationFrame: () => {},
    setInterval: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms, kind: 'interval' }); return id },
    clearInterval: (id) => { timers.delete(id) },
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms, kind: 'timeout' }); return id },
    clearTimeout: (id) => { timers.delete(id) },
    MutationObserver: class {
      constructor() {}
      observe() {}
      disconnect() {}
    },
    Date,
    Math,
    JSON,
    Set,
    Map,
  }
  createContext(context)

  const mod = runInContext(`(function () {\n${inner}\nreturn { apply, inject };\n})()`, context)
  return { mod, fakeRoot, textNode, rafQueue, timers, context }
}

/** 执行当前所有 interval 回调（打字机删除/输入用），直到没有 interval 或达到 guard 上限。 */
function fireIntervals(harness, guard = 300) {
  let runs = 0
  while (runs++ < guard) {
    const intervals = [...harness.timers.values()].filter((t) => t.kind === 'interval')
    if (intervals.length === 0) return runs
    for (const t of intervals) t.fn()
  }
  return runs
}

/** 执行并移除当前所有 timeout 回调（打字机停顿用）。 */
function fireTimeouts(harness) {
  for (const [id, t] of [...harness.timers]) {
    if (t.kind === 'timeout') {
      harness.timers.delete(id)
      t.fn()
    }
  }
}

function eyePolygons(harness) {
  const span = harness.fakeRoot.children.find(
    (c) => c.attrs['data-thought-buddy'] === 'avatar',
  )
  if (!span) return null
  const g = span.children[0].children[0]
  const eyes = g.children.find((c) => c.tagName === 'g' && c.attrs['clip-path'])
  return eyes ? eyes.children : null
}

function parsePoints(poly) {
  return (poly.attrs.points || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.split(',').map(Number))
}

function bboxHeight(poly) {
  const pts = parsePoints(poly)
  if (pts.length === 0) return 0
  const ys = pts.map(([, y]) => y)
  return Math.max(...ys) - Math.min(...ys)
}

let failures = 0
function check(ok, label) {
  if (ok) console.log(`ok: ${label}`)
  else { failures++; console.error(`FAIL: ${label}`) }
}

/* ================= 1) 契约 ================= */
{
  const h = createHarness()
  const { mod } = h
  check(typeof mod.apply === 'function', 'apply exported')
  check(Array.isArray(mod.inject) && mod.inject.length === 0, `inject = ${JSON.stringify(mod.inject)} (empty — no cordis services needed)`)
}

/* ================= 2/3) 挂载与几何 ================= */
{
  const h = createHarness()
  let cleanup = null
  h.mod.apply({ effect: (fn) => { cleanup = fn(); return cleanup } })
  check(typeof cleanup === 'function', 'effect cleanup registered')

  const span = h.fakeRoot.children.find((c) => c.attrs['data-thought-buddy'] === 'avatar')
  check(!!span, 'avatar span inserted into status element')
  const svg = span?.children[0]
  check(svg && svg.tagName === 'svg' && svg.attrs.viewBox === '0 0 259 259', 'svg viewBox correct')
  const g = svg?.children[0]
  const body = g?.children.find((c) => c.tagName === 'path' && c.attrs.fill && c.attrs.fill.startsWith('#'))
  const clip = g?.children.find((c) => c.tagName === 'clipPath')
  const eyes = g?.children.find((c) => c.tagName === 'g' && c.attrs['clip-path'])
  const polys = eyes?.children.filter((c) => c.tagName === 'polygon') ?? []
  check(polys.length === 2, `svg mounted — body=${body?.attrs.fill}, clip=${clip?.attrs.id}, 2 eye polygons`)

  const d = body?.attrs.d ?? ''
  const arcs = (d.match(/A/g) || []).length
  const nums = d.match(/[-\d.]+/g).map(Number)
  const inBox = nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 259)
  check(arcs === 4 && inBox, 'body path — 4 elliptical corner arcs, coords finite, within viewBox')

  for (let i = 0; i < 3; i++) {
    const cb = h.rafQueue.shift()
    if (cb) cb(1000 + i * 16.7)
  }
  let pointsOk = true
  for (const poly of polys) {
    const pts = parsePoints(poly)
    if (pts.length !== 48) pointsOk = false
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 259 || y < 0 || y > 259) {
        pointsOk = false
      }
    }
  }
  check(pointsOk, 'eye polygons — 48 finite in-box points each after 3 frames')

  /* 4) 自停 */
  h.fakeRoot.isConnected = false
  const pending = h.rafQueue.length
  const cb = h.rafQueue.shift()
  if (cb) cb(1100)
  check(h.rafQueue.length === pending - 1, 'animation self-stops when status element detaches')
}

/* ================= 4) emoji 模式 ================= */
{
  const h = createHarness()
  h.context.localStorage.getItem = (key) =>
    key === 'dsh-thought-buddy.mode' ? 'emoji' : null
  h.mod.apply({ effect: (fn) => fn() })
  const span = h.fakeRoot.children.find((c) => c.attrs['data-thought-buddy'] === 'emoji')
  check(!!span && !!span.textContent, `emoji mode — glyph="${span?.textContent ?? ''}"`)
}

/* ================= 5) 眨眼节奏（回归） ================= */
{
  let clock = 1000
  const h = createHarness({ now: () => clock })
  h.mod.apply({ effect: (fn) => fn() })

  // 模拟 ~22s：先让 baseline 稳定（取最大眼高），再检测眨眼帧
  const events = []
  let baseline = 0
  let inBlink = false
  let eventStart = 0
  const blinkWindowMs = 22000
  const STEP = 16.7
  const frames = Math.ceil(blinkWindowMs / STEP)

  for (let i = 0; i < frames; i++) {
    const ts = 1000 + i * STEP
    clock = ts
    const cb = h.rafQueue.shift()
    if (cb) cb(ts)
    const polys = eyePolygons(h)
    if (!polys) continue
    const height = Math.max(...polys.map(bboxHeight))
    if (height > baseline) baseline = height
    // 眨眼时 scaleY 压到 0.04 量级 → 眼高 < 15% 峰值；表情形变不会到这个深度
    const blinking = height < baseline * 0.15
    if (blinking && !inBlink) {
      inBlink = true
      eventStart = ts
    } else if (!blinking && inBlink) {
      inBlink = false
      events.push(eventStart)
    }
  }
  if (inBlink) events.push(eventStart)

  // 事件数：节奏 3.5–7s，22s 窗口期望 ~3–5 次；容忍 2–7
  check(events.length >= 2 && events.length <= 7, `blink events in 22s = ${events.length} (expect ~3–5)`)
  const gaps = events.slice(1).map((t, i) => (t - events[i]) / 1000)
  const minGap = gaps.length ? Math.min(...gaps) : Infinity
  check(minGap >= 3.4, `min blink gap = ${minGap.toFixed(2)}s (>= 3.4s)`)
  console.log(`  blink events at: ${events.map((t) => ((t - 1000) / 1000).toFixed(1) + 's').join(', ')}`)
}

/* ================= 6) 打字机文字 + 表情同步 ================= */
{
  let clock = 1000
  const h = createHarness({ now: () => clock })
  h.mod.apply({ effect: (fn) => fn() })

  // 初始文字 = React 渲染的 "Deep diving..."
  check(h.textNode.textContent === 'Deep diving...', `initial status text = "${h.textNode.textContent}"`)

  // 推进 rAF 直到第一次表情切换（exprAt = mount + 2000~3600ms）——
  // 表情切换的 tick 会通过 onExpression 创建打字机删除定时器
  const STEP = 16.7
  const maxTicks = 600
  let armed = false
  for (let i = 0; i < maxTicks && !armed; i++) {
    const ts = 1000 + i * STEP
    clock = ts
    const cb = h.rafQueue.shift()
    if (cb) cb(ts)
    armed = [...h.timers.values()].some((t) => t.kind === 'interval')
  }
  check(armed, 'first expression switch triggers typewriter (delete interval armed)')
  // 跑一次删除定时器，确认逐字符删除
  const del = [...h.timers.values()].find((t) => t.kind === 'interval')
  if (del) del.fn()
  check(h.textNode.textContent.length < 'Deep diving...'.length, `deleting phase active ("${h.textNode.textContent}")`)

  // 删除到空 → 停顿 timeout → 逐字输入新词
  fireIntervals(h)
  fireTimeouts(h)
  fireIntervals(h)
  const finalText = h.textNode.textContent
  const wordMatch = /^[A-Za-z]+\.\.\.$/.exec(finalText)
  check(
    !!wordMatch && finalText !== 'Deep diving...' && wordMatch[0].length > 6,
    `typewriter produced "${finalText}" (a word from the list + "...")`,
  )

  // 推进到第二次表情切换 → 再次武装删除定时器
  const before2 = h.textNode.textContent
  let switched2 = false
  for (let i = 0; i < maxTicks && !switched2; i++) {
    const ts = 1000 + (maxTicks + i) * STEP
    clock = ts
    const cb = h.rafQueue.shift()
    if (cb) cb(ts)
    switched2 = [...h.timers.values()].some((t) => t.kind === 'interval') || h.textNode.textContent !== before2
  }
  check(switched2, 'second expression switch retriggers typewriter')

  // 完整跑完第二轮，确认又产出新词
  fireIntervals(h)
  fireTimeouts(h)
  fireIntervals(h)
  check(
    /^[A-Za-z]+\.\.\.$/.test(h.textNode.textContent),
    `second cycle produced "${h.textNode.textContent}"`,
  )
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
