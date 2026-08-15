#!/usr/bin/env node
/**
 * build.mjs — 组装 DSH web 客户端 bundle 与宿主产物，无需任何 npm 依赖：
 *
 *   lib/client.js  浏览器半区：data.js + index.js 包进 window.__ModuleLoader__
 *                  CJS 工厂契约（id = 完整包名），并导出 apply / inject。
 *   lib/index.js   宿主半区：src/index.js 原样复制（node ESM）。
 *
 * 两个客户端源文件必须是「纯脚本」（无 ESM import/export）；构建时做一次
 * 语句级检查兜底。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = '@dsh-plugin/dsh-thought-buddy'

const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** ESM 语句兜底检查：import 声明 / export 声明。注释里的字样不匹配。 */
function assertPlainScript(source, label) {
  const importRe = /(^|\n)\s*import\s+[`'"{\w*]/m
  const exportRe = /(^|\n)\s*export\s+(const|function|let|var|class|default|\{)/m
  if (importRe.test(source)) {
    throw new Error(`${label}: contains an ESM import statement — keep the client plain scripts`)
  }
  if (exportRe.test(source)) {
    throw new Error(`${label}: contains an ESM export statement — keep the client plain scripts`)
  }
}

const dataSource = read('src/client/data.js')
const clientSource = read('src/client/index.js')
assertPlainScript(dataSource, 'src/client/data.js')
assertPlainScript(clientSource, 'src/client/index.js')

const banner = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`
const footer = `
\t\texports.apply = apply;
\t\texports.inject = inject;
\t\treturn module.exports;
\t}
});
`

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'client.js'), banner + dataSource + '\n' + clientSource + footer)
writeFileSync(join(root, 'lib', 'index.js'), read('src/index.js'))

const clientBytes = (await import('node:fs')).statSync(join(root, 'lib', 'client.js')).size
console.log(`ok: lib/client.js (${clientBytes} bytes)`)
console.log(`ok: lib/index.js (${readFileSync(join(root, 'lib', 'index.js'), 'utf8').length} bytes)`)
