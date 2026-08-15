#!/usr/bin/env node
/** 校验 .github/workflows/*.yml 的 YAML 语法（开发辅助脚本，供本地/CI 复用）。 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let yaml
try {
  yaml = require('js-yaml') // 项目内（若有）
} catch {
  // dsh 安装树内的 js-yaml（开发机 fallback）
  yaml = require('C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml')
}

const workflowsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
if (files.length === 0) throw new Error('no workflow files found')

for (const file of files) {
  const doc = yaml.load(readFileSync(join(workflowsDir, file), 'utf8'))
  const jobs = Object.keys(doc?.jobs ?? {})
  console.log(`ok: ${file} — ${doc?.name ?? 'untitled'}, jobs: ${jobs.join(', ')}`)
}
