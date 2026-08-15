#!/usr/bin/env node
/**
 * gen-data.mjs — 生成 src/client/data.ts（纯脚本、无 ESM），数据源优先级：
 *
 *   1) ref/GrokBot/lib/src/data/*.dart（上游 GrokBot 的 Dart 数据源，git 忽略）
 *   2) 缺失时回读现有 data.ts 幂等再生成（保证 `npm run gen` 在任何检出上都可用，
 *      且 CI 无 ref/ 时 `git diff --exit-code` 保持干净）
 *
 * 解析对象：
 *   - expression_data.dart  → 25 个表情 × 2 只眼 × 48 个点（TB_EXPRESSIONS）
 *   - shape_data.dart       → 18 种形态参数（TB_SHAPES，radius 即 CSS border-radius 语法）
 *   - state_data.dart       → 39 种状态的表情池与节奏（TB_STATES）
 *
 * 用法：node scripts/gen-data.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  outFile,
  parseDataTs,
  parseExpressions,
  parseShapes,
  parseStates,
  refDataDir,
  refDataPresent,
  renderDataTs,
} from './gen-data-lib.mjs'

const read = (rel) => readFileSync(rel, 'utf8')

let expressions
let shapes
let states
if (refDataPresent()) {
  expressions = parseExpressions(read(`${refDataDir}/expression_data.dart`))
  shapes = parseShapes(read(`${refDataDir}/shape_data.dart`))
  states = parseStates(read(`${refDataDir}/state_data.dart`))
  console.log('info: parsed from ref/GrokBot Dart sources')
} else {
  ;({ expressions, shapes, states } = parseDataTs(read(outFile)))
  console.log('info: ref/GrokBot not present — idempotent re-render from current data.ts')
}

if (expressions.length !== 25) throw new Error(`expected 25 expressions, got ${expressions.length}`)
if (Object.keys(shapes).length !== 18) throw new Error(`expected 18 shapes, got ${Object.keys(shapes).length}`)
if (Object.keys(states).length !== 39) throw new Error(`expected 39 states, got ${Object.keys(states).length}`)

const body = renderDataTs({ expressions, shapes, states })

writeFileSync(outFile, body)
console.log(`ok: ${outFile}`)
console.log(`  expressions=${expressions.length} (${expressions.length * 96} points)`)
console.log(`  shapes=${Object.keys(shapes).length}`)
console.log(`  states=${Object.keys(states).length}`)
console.log(`  bytes=${Buffer.byteLength(body)}`)
