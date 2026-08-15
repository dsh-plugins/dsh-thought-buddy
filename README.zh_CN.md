<div align="center">

# dsh-thought-buddy

**DeepSeek Harness Web 插件：在「Deep diving...」状态提示前，放一只动态小伙伴——GrokBot 风格动画头像，状态文字还会同步打字机变换。**

[English](README.md) | 简体中文

</div>

`dsh-thought-buddy` 是 [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) Web GUI 的纯客户端插件。模型工作时，那行 `Deep diving...` 状态条前多了一只 Grok 风格的小机器人头像：眨眼、弹簧形变换表情、视线游移、整体轻摆——全部由 **纯 SVG + `requestAnimationFrame`** 实时绘制，零运行时依赖。每次头像切换表情，状态文字还会以**打字机效果**变换（先逐字符删除，再逐字打出下一个词）。

头像动画移植自 [nasawz/GrokBot](https://github.com/nasawz/GrokBot)（纯 Flutter `CustomPaint` 控件）：25 种表情 × 2 眼 × 48 点眼环、18 种身体形态、39 种状态的表情池与眨眼节奏全部保留。

## 功能

| 功能 | 说明 |
|---|---|
| GrokBot 头像 | thinking 状态表情池 `[8,16,14,17,5]` 自动轮换，弹簧形变表情过渡、320ms 眨眼（随机 3.5–7s 间隔）、球面转头投影 + 视线游移、整体轻摆（1.7s 呼吸动画） |
| 表情联动打字机 | 每次表情切换时，状态行文字从 `Deep diving...` 以打字机效果变换（先逐字符删除、停顿后逐字打出），从 55 个候选词（`Accomplishing`…`Working`）轮换，如 `Reticulating...`；React 重渲染不会覆盖（文本 fiber 的 children 字符串始终不变，React bail out） |
| Emoji 模式 | 备用模式：在 emoji 列表间轮播（默认 `🤿 🫧 🌊 🐙 🔍 🧠 💭`），每次切换带弹跳入场 |
| 主题适配 | 跟随 `prefers-color-scheme`：亮色 `#5b7fe5/#fffdf7`，暗色 `#6689ea/#181a15`（与 DSH 主题一致） |
| 减少动效 | `prefers-reduced-motion: reduce` 时关闭摆动与转头，仅保留表情/眨眼 |
| 自动清理 | 状态条消失时动画自停；插入节点在 React 重渲染下存活，万一被清掉，下一次 mutation 自动补回 |

## 安装

插件以 `link:` 依赖接入 web profile（示例：`C:\Users\Administrator\.dsh\profiles\web`）：

```jsonc
// package.json（profile）
"dependencies": { "@dsh-plugin/dsh-thought-buddy": "link:C:/path/to/dsh-thought-buddy" },
"dsh": { "profile": { "bundles": [ /* ... */, "@dsh-plugin/dsh-thought-buddy" ] } }
```

1. 构建产物：`npm run build`（或 `node scripts/build.mjs`）生成 `lib/client.js` + `lib/index.js`
2. profile 内 `pnpm install`（离线亦可）
3. **重启 `dsh web`** —— 客户端模块清单在启动时组合，新 bundle 需要重启生效
4. 刷新页面后，给模型发一条消息，「Deep diving...」前即出现小伙伴

## 配置（localStorage，改完刷新生效）

| Key | 默认 | 说明 |
|---|---|---|
| `dsh-thought-buddy.enabled` | `1` | `0` 关闭插件 |
| `dsh-thought-buddy.mode` | `avatar` | `emoji` 切换为 emoji 轮播 |
| `dsh-thought-buddy.size` | `18` | 头像像素尺寸（8–64） |
| `dsh-thought-buddy.emojis` | `🤿 🫧 🌊 🐙 🔍 🧠 💭` | 空格/逗号分隔的 emoji 列表（emoji 模式） |

```js
// 控制台示例
localStorage.setItem('dsh-thought-buddy.mode', 'emoji')
localStorage.setItem('dsh-thought-buddy.size', '22')
location.reload()
```

## 开发

```
dsh-thought-buddy/
├── ref/GrokBot/            # 参考项目（git 忽略，只读）
├── src/
│   ├── index.js            # 宿主半区（no-op 挂载行）
│   └── client/
│       ├── data.js         # 生成数据：25 表情 × 2 眼 × 48 点、18 形态、39 状态
│       └── index.js        # 客户端引擎：SVG 头像 + 打字机 + 观察器 + apply()
├── scripts/
│   ├── gen-data.mjs        # 从 ref/GrokBot 的 Dart 数据源重新生成 data.js
│   └── build.mjs           # 组装 lib/client.js（__ModuleLoader__ 契约）与 lib/index.js
├── test/verify.mjs         # 无浏览器测试：直接执行构建产物（SVG/节奏/打字机）
├── demo/                   # 本地预览（node demo/server.mjs → 4173）
└── cordis.patch.yml        # bundle patch：插入 thought-buddy 行
```

```sh
npm run gen           # 更新数据（上游 GrokBot 数据变更后）
npm run build         # 构建 lib/ 产物
npm run verify        # 全量无浏览器验证
node demo/server.mjs 4173   # 预览 http://127.0.0.1:4173/demo/demo.html
```

## 架构

- **宿主半区**：仅提供一个 cordis bundle 挂载行（`cordis.patch.yml` 插入 `thought-buddy`），让 client-modules 扫描到 `dsh.client` 声明与 `exports["./client"]`，浏览器半区以 `/plugins/@dsh-plugin/dsh-thought-buddy/client.js` 加载。
- **客户端半区**：`apply(ctx)` 注册 `MutationObserver`，监听 `[data-conversation-scroll] [role="status"]`（文案含 "diving"）的状态条；头像/打字机插入文本前，随状态条 DOM 生命周期自动挂载与清理。
- **动画**：逐帧移植 Flutter `_GrokBotState._onTick` —— 临界阻尼弹簧表情形变（ω=7，1/120 子步）、thinking 表情池轮换、320ms 眨眼曲线、球面转头投影（`asin`/`cos` 深度裁切）、视线游移；多边形坐标每帧直接写 SVG `points` 属性。
- **打字机**：基于状态条的文本节点的定时器状态机。React 不会触碰该节点——文本 fiber 的 children 字符串始终是 `"Deep diving..."`（bail out），与注入的头像节点同理。

> ⚠️ 注意区分两个 inject：bundle 导出的 `exports.inject` 是 **cordis 服务依赖**（本插件只用 `ctx.effect`，必须为空数组；写成包名会导致 boot 时 fiber 永久等待不存在的服务而报 `pending (waiting for service: ...)`）；`package.json` 的 `dsh.client.inject` 是**客户端模块依赖声明**（本插件不依赖任何 client 服务，故省略）。

## License

[BSD-3-Clause](LICENSE)。眼环几何、身体形态与状态节奏数据源自 [nasawz/GrokBot](https://github.com/nasawz/GrokBot)（BSD-3-Clause, Copyright (c) 2026 nasawz），已在 LICENSE 中署名。
