#!/usr/bin/env node
/** 校验 .github/workflows/*.yml 的 YAML 语法（开发辅助脚本，供本地/CI 复用）。 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
// js-yaml 是可选依赖：项目零依赖，CI 上没有 js-yaml 时优雅跳过
// （GitHub 自身会在 push 时校验 workflow 语法）。开发机上优先用
// 项目内安装，其次 dsh 安装树内的副本。
function loadYaml() {
  for (const candidate of [
    'js-yaml',
    'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml',
  ]) {
    try {
      return require(candidate)
    } catch {
      // try next
    }
  }
  return null
}
const yaml = loadYaml()
if (yaml === null) {
  console.log('info: js-yaml not available in this environment — skipping workflow YAML validation (GitHub validates workflow syntax on push)')
  process.exit(0)
}

const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
if (files.length === 0) throw new Error('no workflow files found')

for (const file of files) {
  const doc = yaml.load(readFileSync(join(workflowsDir, file), 'utf8'))
  const jobs = Object.keys(doc?.jobs ?? {})
  console.log(`ok: ${file} — ${doc?.name ?? 'untitled'}, jobs: ${jobs.join(', ')}`)
}
