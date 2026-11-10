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

/* ---------- 标准管线契约：整包求值，经 __ModuleLoader__ 壳取回声明 ----------
 * tsdown 产物首行即 window.__ModuleLoader__.load({ id, factory })；在 vm 沙箱
 * 里提供 window 桩捕获声明，再以「无 external」的 require 桩调工厂，取回
 * module.exports（含 apply / inject）。不再按字节剥壳。 */
if (!bundle.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('lib/client.js is not wrapped in the __ModuleLoader__.load shell')
}

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
    this._detached = false
    this._textContent = ''
    this.dataset = {}
  }
  /**
   * 与真实 DOM 一致地向下传播：祖先脱离文档，后代的 isConnected 也随之为 false。
   *
   * 这一点在迁移到 dshLoader.ui 之后变得重要——rAF 循环的存活基准从「状态条」
   * 改成了「loader 提供的挂载节点」（既能感知宿主脱离，也能感知 React 只清空了
   * 宿主子节点）。若桩不传播，测试会误判动画没有自停。
   */
  get isConnected() {
    if (this._detached) return false
    return this.parentNode ? this.parentNode.isConnected : true
  }
  set isConnected(value) { this._detached = !value }
  get textContent() { return this._textContent + this.childNodes.map((node) => node.textContent).join('') }
  set textContent(value) { this._textContent = value }
  get parentElement() { return this.parentNode }
  closest(selector) {
    if (selector === '[data-chat-running]' && this.attrs['data-chat-running']) return this
    return this.parentNode?.closest(selector) ?? null
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
  remove() {
    const parent = this.parentNode
    if (!parent) return
    parent.children = parent.children.filter((c) => c !== this)
    parent.childNodes = parent.childNodes.filter((c) => c !== this)
    this.parentNode = null
    this.isConnected = false
  }
  querySelector(selector) {
    if (selector === ':scope > [class*="_runningText"]') {
      return this.children.find((c) => c.className?.endsWith('_runningText')) ?? null
    }
    if (selector === ':scope > [role="status"]') {
      return this.children.find((c) => c.attrs.role === 'status') ?? null
    }
    return null
  }
}

class FakeText {
  nodeType = 3
  constructor(data) { this.data = data }
  get isConnected() { return this.parentNode?.isConnected ?? false }
  get textContent() { return this.data }
}

function createHarness({ now = () => Date.now(), running = false } = {}) {
  const rafQueue = []
  let rafId = 0
  // 可控定时器：setInterval/setTimeout 收集到这里，测试手动执行
  const timers = new Map()
  let timerSeq = 0
  const fakeRoot = new FakeNode('div')
  const textNode = new FakeText('Deep diving...')
  const announcement = new FakeNode('span')
  const label = new FakeNode('span')
  const observers = new Map()
  if (running) {
    const row = new FakeNode('div')
    row.setAttribute('data-chat-running', 'true')
    announcement.setAttribute('role', 'status')
    announcement.appendChild(new FakeText('深度求索中'))
    row.appendChild(announcement)
    row.appendChild(fakeRoot)
    label.className = 'host_runningText'
    label.textContent = '深度求索中，用时 31分2秒 ···'
    fakeRoot.appendChild(label)
  } else {
    fakeRoot.appendChild(textNode)
  }

  const context = {
    console,
    window: {
      __ModuleLoader__: {
        load(declaration) { context.declaration = declaration },
      },
    },
    document: {
      createElementNS: (ns, tag) => new FakeNode(tag, ns),
      createElement: (tag) => new FakeNode(tag),
      createTextNode: (data) => new FakeText(data),
      head: new FakeNode('head'),
      documentElement: new FakeNode('html'),
      querySelector: () => null,
      querySelectorAll: (sel) => (running && sel.includes('_runningContent') ? [fakeRoot] : []),
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
      nodes = new Set()
      constructor(callback) { this.callback = callback }
      observe(node) { this.nodes.add(node); observers.set(node, this.callback) }
      disconnect() {
        for (const node of this.nodes) observers.delete(node)
        this.nodes.clear()
      }
    },
    Date,
    Math,
    JSON,
    Set,
    Map,
  }
  context.preferences = { enabled: true, mode: 'avatar', size: 18, emojis: ['🤿','🫧'] }
  context.window.__dshLoader__ = { config: {
    read: async () => ({ value: context.preferences }),
    subscribe: listener => { context.configChanged = listener; return () => { context.configChanged = undefined } },
  } }
  createContext(context)

  /**
   * dshLoader.ui 的最小替身。
   *
   * 插件不再自己观察 DOM，而是向 loader 注册一个 slot，因此这里忠实复刻
   * ui.mount 对插件可见的那部分语义：解析锚点得到宿主 → 过 when 判定 → 创建带
   * data-dshl-slot 的挂载节点并按 prepend 放置 → 调 render(mount, host) → 返回
   * 执行 cleanup 的 disposer。
   *
   * 观察器、rAF 合流与自愈补回属于 loader 的职责，由 dsh-loader 自己的 jsdom
   * 测试覆盖，不在本产物校验范围内。
   */
  const anchors = new Map([
    ['conversation.status', { find: () => [running ? announcement : fakeRoot] }],
  ])
  const mounted = new Map()
  const uiStub = {
    defineAnchor(name, spec) {
      anchors.set(name, spec)
      return () => { mounted.get(name)?.(); anchors.delete(name) }
    },
    mount(anchor, spec) {
      const hosts = anchors.get(anchor).find()
      const cleanups = []
      for (const host of hosts) {
        if (typeof spec.when === 'function' && !spec.when(host)) continue
        const mount = context.document.createElement('span')
        mount.setAttribute('data-dshl-slot', spec.id)
        host.insertBefore(mount, host.children[0])
        const cleanup = spec.render(mount, host)
        cleanups.push(() => {
          if (typeof cleanup === 'function') cleanup()
          mount.remove()
        })
      }
      const stop = () => {
        for (const c of cleanups) c()
        mounted.delete(anchor)
      }
      mounted.set(anchor, stop)
      return stop
    },
  }

  runInContext(bundle, context)
  if (context.declaration === undefined) throw new Error('bundle did not register via __ModuleLoader__.load')
  // 客户端无任何 external 运行时依赖；require 桩被调用即为错误。
  const mod = context.declaration.factory((id) => { throw new Error(`unexpected require: ${id}`) })
  return { mod, fakeRoot, textNode, announcement, label, observers, rafQueue, timers, context, uiStub }
}

/**
 * 找到插件渲染出的表情节点。
 *
 * 层级比迁移前多一层：loader 先在状态条里放一个 data-dshl-slot 挂载节点，插件
 * 再往其中追加 data-thought-buddy。
 */
function buddySpan(harness, kind) {
  for (const slot of harness.fakeRoot.children) {
    if (!slot.attrs || slot.attrs['data-dshl-slot'] === undefined) continue
    const found = slot.children.find((c) => c.attrs['data-thought-buddy'] === kind)
    if (found) return found
  }
  return undefined
}

function buddyText(harness, className) {
  const slot = harness.fakeRoot.children.find((c) => c.attrs?.['data-thought-buddy-row'])
  return slot?.children.find((c) => c.className === className)
}

function fireNextTimeout(harness) {
  const next = [...harness.timers].find(([, timer]) => timer.kind === 'timeout')
  if (!next) return false
  const [id, timer] = next
  harness.timers.delete(id)
  timer.fn()
  return true
}

function eyePolygons(harness) {
  const span = buddySpan(harness, 'avatar')
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
  check(
    Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === 'dshLoaderUi',
    `inject = ${JSON.stringify(mod.inject)} (declares the dshLoaderUi service)`,
  )
}

/* ================= 2/3) 挂载与几何 ================= */
{
  const h = createHarness()
  let cleanup = null
  await h.mod.apply({ effect: (fn) => { cleanup = fn(); return cleanup }, dshLoaderUi: h.uiStub })
  check(typeof cleanup === 'function', 'effect cleanup registered')

  const span = buddySpan(h, 'avatar')
  check(!!span, 'avatar span rendered into the dshLoader.ui mount node')
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
  h.context.preferences.mode = 'emoji'
  await h.mod.apply({ effect: (fn) => fn(), dshLoaderUi: h.uiStub })
  const span = buddySpan(h, 'emoji')
  check(!!span && !!span.textContent, `emoji mode — glyph="${span?.textContent ?? ''}"`)
}

/* ================= 5) 眨眼节奏（回归） ================= */
{
  let clock = 1000
  const h = createHarness({ now: () => clock })
  await h.mod.apply({ effect: (fn) => fn(), dshLoaderUi: h.uiStub })

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
  const h = createHarness({ now: () => clock, running: true })
  let cleanup
  await h.mod.apply({ effect: (fn) => { cleanup = fn() }, dshLoaderUi: h.uiStub })
  const word = buddyText(h, 'tb-word')
  const elapsed = buddyText(h, 'tb-elapsed')
  check(!!buddySpan(h, 'avatar') && h.announcement.children.length === 1, 'avatar mounts in visible running content only')
  check(word?.textContent === 'Thinking...' && elapsed?.textContent === '用时 31分2秒', 'status is replaced immediately and elapsed time renders separately')

  const switchExpression = () => {
    clock += 4000
    h.rafQueue.shift()?.(clock)
  }
  switchExpression()
  fireNextTimeout(h)
  check(word?.textContent === 'Thinking..', 'expression switch erases one character at a time')

  h.label.textContent = '深度求索中，用时 31分3秒 ···'
  h.observers.get(h.label)?.()
  check(elapsed?.textContent === '用时 31分3秒' && word?.textContent === 'Thinking..', 'host ticks update elapsed time during erasing')

  for (let step = 0; step < 20 && word?.textContent; step++) fireNextTimeout(h)
  const [pause] = h.timers.keys()
  switchExpression()
  check(h.timers.size === 1 && !h.timers.has(pause), 'new expression cancels the previous pause timer')
  for (let step = 0; step < 50 && h.timers.size; step++) fireNextTimeout(h)
  check(/^[A-Za-z]+\.\.\.$/.test(word?.textContent ?? ''), 'typewriter finishes the next word')
  check(h.label.textContent === '深度求索中，用时 31分3秒 ···', 'typewriter preserves the React-owned status')

  const replacement = new FakeNode('span')
  replacement.className = h.label.className
  replacement.textContent = 'Deep diving for 1h 2m 3s ···'
  h.label.remove()
  h.fakeRoot.appendChild(replacement)
  h.observers.get(h.fakeRoot)?.()
  check(elapsed?.textContent === 'for 1h 2m 3s' && !h.observers.has(h.label), 'elapsed time follows the replacement host label')
  replacement.textContent = 'Deep diving for 1h 2m 4s ···'
  h.observers.get(replacement)?.()
  check(elapsed?.textContent === 'for 1h 2m 4s', 'replacement label ticks continue updating elapsed time')

  switchExpression()
  for (let step = 0; step < 20 && word?.textContent; step++) fireNextTimeout(h)
  check(word?.textContent === '' && h.timers.size === 1, 'pause is pending before disposal')
  cleanup()
  check(h.timers.size === 0 && h.observers.size === 0 && !buddySpan(h, 'avatar'), 'unload cancels the pause and elapsed observation')
}

/* ================= independent switches ================= */
{
  const h = createHarness({ running: true })
  h.context.preferences = { ...h.context.preferences, enabled: true, replaceText: false, typewriter: true }
  let cleanup
  await h.mod.apply({ effect: fn => { cleanup = fn() }, dshLoaderUi: h.uiStub })
  check(!!buddySpan(h, 'avatar') && !buddyText(h, 'tb-word') && !buddyText(h, 'tb-elapsed'), 'avatar-only keeps the native label and clock')
  check(h.observers.size === 0 && h.timers.size === 0, 'disabled replacement ignores the stored typewriter preference')

  const refresh = async preferences => {
    Object.assign(h.context.preferences, preferences)
    h.context.configChanged()
    await new Promise(resolve => setImmediate(resolve))
  }
  await refresh({ enabled: false, replaceText: true, typewriter: false })
  const word = buddyText(h, 'tb-word')
  const before = word?.textContent
  check(!buddySpan(h, 'avatar') && !!buddyText(h, 'tb-elapsed'), 'replacement runs independently of the avatar')
  fireNextTimeout(h)
  check(word?.textContent !== before && /^[A-Za-z]+\.\.\.$/.test(word?.textContent ?? ''), 'disabled typewriter swaps the complete word at once')

  await refresh({ typewriter: true })
  const animated = buddyText(h, 'tb-word')
  fireNextTimeout(h)
  fireNextTimeout(h)
  check(animated?.textContent === 'Thinking..', 'typewriter also works with the native whale')

  await refresh({ replaceText: false, typewriter: false })
  check(h.fakeRoot.children.length === 1 && h.fakeRoot.children[0] === h.label, 'all switches off leave the native status untouched')
  check(h.timers.size === 0 && h.observers.size === 0 && h.context.document.head.children.length === 0, 'turning everything off removes timers, observers and styles')
  cleanup()
}

/* ================= live config + late completion ================= */
{
  const h=createHarness(); let cleanup;
  await h.mod.apply({effect:fn=>{cleanup=fn()},dshLoaderUi:h.uiStub});
  h.context.preferences={...h.context.preferences,enabled:false}; h.context.configChanged();
  await new Promise(resolve=>setImmediate(resolve));
  check(!buddySpan(h,'avatar'),'disabling through config removes mounted buddy');
  check(h.textNode.textContent === 'Deep diving...', 'disabling restores the legacy status text')
  h.context.preferences={...h.context.preferences,enabled:true,mode:'emoji'}; h.context.configChanged();
  await new Promise(resolve=>setImmediate(resolve));
  check(!!buddySpan(h,'emoji'),'live config switches to emoji without reloading');
  cleanup();
  check(!h.context.configChanged && !buddySpan(h,'emoji'),'unload unsubscribes and removes the buddy');
}
{
  const h=createHarness(); let cleanup,resolve;
  h.context.window.__dshLoader__.config.read=()=>new Promise(done=>{resolve=done});
  const installing=h.mod.apply({effect:fn=>{cleanup=fn()},dshLoaderUi:h.uiStub});
  cleanup(); resolve({value:h.context.preferences}); await installing;
  check(!buddySpan(h,'avatar'),'a config read completing after unload cannot mount');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
