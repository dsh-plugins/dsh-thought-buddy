#!/usr/bin/env node
/**
 * demo/server.mjs — 零依赖静态文件服务器，用于本地预览 demo/ 页面。
 * 用法：node demo/server.mjs [port] （默认 4173，绑定 127.0.0.1）
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const port = Number.parseInt(process.argv[2] ?? '4173', 10)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/') pathname = '/demo/demo.html'
    const file = normalize(join(root, pathname))
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    const type = MIME[extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  } catch (error) {
    res.writeHead(500)
    res.end(String(error))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`demo server: http://127.0.0.1:${port}/`)
})
