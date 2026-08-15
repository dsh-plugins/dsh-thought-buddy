<div align="center">

# dsh-thought-buddy

**A DeepSeek Harness Web plugin that puts a dynamic little buddy — a GrokBot-style animated avatar with a synchronized typewriter status line — right in front of the "Deep diving..." indicator.**

English | [简体中文](README.zh_CN.md)

</div>

`dsh-thought-buddy` is a pure client-side plugin for the [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) Web GUI. While the model is working, the status pill that reads `Deep diving...` grows a tiny Grok-style robot avatar: it blinks, swaps expressions with a springy morph, wanders its gaze, and gently bobs — all drawn live as **SVG via `requestAnimationFrame`**, with zero runtime dependencies. Every time the avatar switches expression, the status text rewrites itself with a typewriter effect (deleting character by character, then typing out the next word).

The avatar animation is ported from [nasawz/GrokBot](https://github.com/nasawz/GrokBot) (a pure Flutter `CustomPaint` widget) to the web: all 25 expressions × 2 eyes × 48-point eye rings, 18 body shapes, and 39 states with their expression/blink cadences are preserved.

## Features

| Feature | Description |
| --- | --- |
| GrokBot avatar | thinking-state expression pool `[8,16,14,17,5]` cycles automatically; springy morph between expressions; 320 ms blinks (random 3.5–7 s interval); spherical head-turn projection + wandering gaze; gentle 1.7 s breathing bob |
| Expression-synced typewriter | on every expression switch, the status text leaves `Deep diving...` via a typewriter effect (delete character by character, pause, then type out the next word) cycling through 55 candidates (`Accomplishing`…`Working`), e.g. `Reticulating...`; React re-renders never overwrite it (the text fiber's children string never changes, so React bails out) |
| Emoji mode | fallback mode that cycles an emoji list (default `🤿 🫧 🌊 🐙 🔍 🧠 💭`) with a pop-in on every switch |
| Theme aware | follows `prefers-color-scheme`: light `#5b7fe5/#fffdf7`, dark `#6689ea/#181a15` (matching the DSH theme) |
| Reduced motion | under `prefers-reduced-motion: reduce`, the bob and head-turn sway are disabled; expression changes and blinks remain |
| Self-cleaning | the animation stops as soon as the status pill leaves the DOM; inserted nodes survive React re-renders and are re-asserted on the next mutation if ever removed |

## Install

The plugin is wired into a web profile via a `link:` dependency (example: `C:\Users\Administrator\.dsh\profiles\web`):

```jsonc
// package.json (profile)
"dependencies": { "@dsh-plugin/dsh-thought-buddy": "link:C:/path/to/dsh-thought-buddy" },
"dsh": { "profile": { "bundles": [ /* ... */, "@dsh-plugin/dsh-thought-buddy" ] } }
```

1. Build the artifacts: `npm run build` (or `node scripts/build.mjs`) → produces `lib/client.js` + `lib/index.js`
2. In the profile, run `pnpm install` (works offline)
3. **Restart `dsh web`** — the client-module manifest is composed at boot, so a new bundle needs a restart
4. Refresh the page and send the model a message: the buddy appears in front of `Deep diving...`

## Configuration (localStorage, applied on reload)

| Key | Default | Description |
| --- | --- | --- |
| `dsh-thought-buddy.enabled` | `1` | `0` disables the plugin |
| `dsh-thought-buddy.mode` | `avatar` | `emoji` switches to emoji cycling |
| `dsh-thought-buddy.size` | `18` | avatar size in px (8–64) |
| `dsh-thought-buddy.emojis` | `🤿 🫧 🌊 🐙 🔍 🧠 💭` | space/comma-separated emoji list (emoji mode) |

```js
// console example
localStorage.setItem('dsh-thought-buddy.mode', 'emoji')
localStorage.setItem('dsh-thought-buddy.size', '22')
location.reload()
```

## Development

```
dsh-thought-buddy/
├── ref/GrokBot/            # reference project (git-ignored, read-only)
├── src/
│   ├── index.js            # host half (no-op mount row)
│   └── client/
│       ├── data.js         # generated data: 25 expressions × 2 eyes × 48 points, 18 shapes, 39 states
│       └── index.js        # client engine: SVG avatar + typewriter + observer + apply()
├── scripts/
│   ├── gen-data.mjs        # regenerates data.js from ref/GrokBot's Dart sources
│   └── build.mjs           # assembles lib/client.js (__ModuleLoader__ contract) + lib/index.js
├── test/verify.mjs         # browserless tests against the built bundle (SVG, pacing, typewriter)
├── demo/                   # local preview (node demo/server.mjs → 4173)
└── cordis.patch.yml        # bundle patch: inserts the thought-buddy row
```

```sh
npm run gen           # refresh data (after upstream GrokBot data changes)
npm run build         # build lib/ artifacts
npm run verify        # full browserless verification
node demo/server.mjs 4173   # preview http://127.0.0.1:4173/demo/demo.html
```

## Architecture

- **Host half**: provides only the cordis bundle mount row (`cordis.patch.yml` inserts `thought-buddy`), so client-modules discovers the `dsh.client` declaration and `exports["./client"]`, serving the browser half at `/plugins/@dsh-plugin/dsh-thought-buddy/client.js`.
- **Client half**: `apply(ctx)` registers a `MutationObserver` watching `[data-conversation-scroll] [role="status"]` pills whose text contains "diving"; the avatar/typewriter mount in front of the text and live with the pill's DOM lifecycle.
- **Animation**: a per-frame port of Flutter's `_GrokBotState._onTick` — critically-damped spring expression morphing (ω=7, 1/120 substeps), thinking-pool expression switching, 320 ms blink curve, spherical head-turn projection (`asin`/`cos` depth culling), wandering gaze; polygon coordinates are written to the SVG `points` attribute every frame.
- **Typewriter**: a timer-driven state machine over the pill's text node. React never touches the node because the text fiber's `children` string is always `"Deep diving..."` (bail-out), exactly like the injected avatar node.

> ⚠️ Two different `inject`s: the bundle's exported `exports.inject` is the **cordis service dependency** (this plugin only uses `ctx.effect`, so it must be an empty array — putting package names there makes the fiber wait forever for a service that does not exist and boot fails with `pending (waiting for service: ...)`); `package.json`'s `dsh.client.inject` is the **client module dependency declaration** (this plugin needs none, so it is omitted).

## License

[BSD-3-Clause](LICENSE). The eye-ring geometry, body shapes, and state cadences derive from [nasawz/GrokBot](https://github.com/nasawz/GrokBot) (BSD-3-Clause, Copyright (c) 2026 nasawz), credited in the LICENSE file.
