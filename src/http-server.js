'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const { handleMessage } = require('./mcp')
const { getSession, listSessions } = require('./session')
const { callTool, TOOLS, EXPORTS } = require('./tools')

const ROOT = path.join(__dirname, '..')
const WEBSITE = path.join(ROOT, 'website')
const VENDOR = path.join(ROOT, 'vendor')
const PORT = Number(process.env.PORT) || 8787
const HOST = process.env.HOST || '0.0.0.0'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.bloxdschem': 'application/octet-stream',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function send(res, status, body, headers) {
  cors(res)
  const payload = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body)
  const outHeaders = {
    'Content-Type': typeof body === 'string' && body.startsWith('<') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    ...(headers || {})
  }
  if (!Buffer.isBuffer(payload) && typeof payload === 'string') {
    outHeaders['Content-Length'] = Buffer.byteLength(payload)
  } else if (Buffer.isBuffer(payload)) {
    outHeaders['Content-Length'] = payload.length
  }
  res.writeHead(status, outHeaders)
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > 40 * 1024 * 1024) {
        reject(new Error('Request too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0])
  const resolved = path.normalize(path.join(root, decoded))
  if (!resolved.startsWith(root)) return null
  return resolved
}

function serveStatic(req, res, urlPath) {
  let filePath
  if (urlPath.startsWith('/vendor/')) filePath = safeJoin(VENDOR, urlPath.slice('/vendor'.length))
  else if (urlPath.startsWith('/exports/')) filePath = safeJoin(EXPORTS, urlPath.slice('/exports'.length))
  else filePath = safeJoin(WEBSITE, urlPath === '/' ? '/index.html' : urlPath)
  if (!filePath) return send(res, 403, { error: 'Forbidden' })
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (!path.extname(urlPath)) {
        const fallback = path.join(WEBSITE, 'index.html')
        return fs.readFile(fallback, (err2, data) => {
          if (err2) return send(res, 404, { error: 'Not found' })
          cors(res)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(data)
        })
      }
      return send(res, 404, { error: 'Not found' })
    }
    const ext = path.extname(filePath).toLowerCase()
    cors(res)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
      'Content-Length': stat.size,
      'Content-Disposition': ext === '.bloxdschem' || ext === '.zip' || ext === '.js' && urlPath.startsWith('/exports/')
        ? `attachment; filename="${path.basename(filePath)}"`
        : 'inline'
    })
    fs.createReadStream(filePath).pipe(res)
  })
}

async function handleMcp(req, res, urlPath) {
  const existing = req.headers['mcp-session-id']
  if (req.method === 'DELETE') {
    return send(res, 200, { ok: true })
  }
  if (req.method === 'GET') {
    const session = getSession(existing || 'studio')
    cors(res)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Mcp-Session-Id': session.id
    })
    res.write(`event: ready\ndata: ${JSON.stringify({ session: session.id })}\n\n`)
    const keep = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => clearInterval(keep))
    return
  }
  const raw = await readBody(req)
  let message
  try { message = JSON.parse(raw.toString('utf8') || '{}') } catch (_err) {
    return send(res, 400, { error: 'Invalid JSON' })
  }
  const isInit = !Array.isArray(message) && message.method === 'initialize'
  const session = getSession(existing || (isInit ? undefined : 'studio'))
  if (Array.isArray(message)) {
    const responses = []
    for (const item of message) {
      const response = await handleMessage(session, item)
      if (response) responses.push(response)
    }
    return send(res, 200, responses, { 'Mcp-Session-Id': session.id })
  }
  const response = await handleMessage(session, message)
  const payload = response || { jsonrpc: '2.0', result: {} }
  const accept = String(req.headers.accept || '')
  if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
    cors(res)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Mcp-Session-Id': session.id
    })
    res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
    res.end()
    return
  }
  return send(res, 200, payload, { 'Mcp-Session-Id': session.id })
}

async function handleApi(req, res, urlPath) {
  const sessionId = req.headers['x-session-id'] || new URL(req.url, 'http://localhost').searchParams.get('session') || 'studio'
  const session = getSession(sessionId)

  if (urlPath === '/api/health') {
    return send(res, 200, { ok: true, server: 'bloxd-mcp', sessions: listSessions().length })
  }
  if (urlPath === '/api/tools' && req.method === 'GET') {
    return send(res, 200, { tools: TOOLS })
  }
  if (urlPath === '/api/sessions' && req.method === 'GET') {
    return send(res, 200, { sessions: listSessions() })
  }
  if (urlPath === '/api/stats' && req.method === 'GET') {
    return send(res, 200, { id: session.id, world: session.world.stats(), mesh: session.mesh.stats() })
  }
  if (urlPath === '/api/world' && req.method === 'GET') {
    const packed = session.world.serializeBlocks(60000)
    return send(res, 200, { id: session.id, stats: session.world.stats(), packed: packed.packed, truncated: packed.truncated })
  }
  if (urlPath === '/api/mesh' && req.method === 'GET') {
    return send(res, 200, { id: session.id, stats: session.mesh.stats(), parts: session.mesh.list() })
  }
  if (urlPath.startsWith('/api/tools/') && req.method === 'POST') {
    const name = decodeURIComponent(urlPath.slice('/api/tools/'.length))
    const raw = await readBody(req)
    let args = {}
    if (raw.length) {
      try { args = JSON.parse(raw.toString('utf8')) } catch (_err) { return send(res, 400, { error: 'Invalid JSON' }) }
    }
    try {
      const result = callTool(session, name, args)
      session.emit('tool', { name, args, result })
      return send(res, 200, result)
    } catch (err) {
      return send(res, 400, { ok: false, error: err.message || String(err) })
    }
  }
  return send(res, 404, { error: 'Unknown API route' })
}

function listen() {
  const server = http.createServer(async (req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    try {
      if (urlPath === '/mcp' || urlPath.startsWith('/mcp/')) return await handleMcp(req, res, urlPath)
      if (urlPath.startsWith('/api/')) return await handleApi(req, res, urlPath)
      return serveStatic(req, res, urlPath)
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: err.message || String(err) })
    }
  })
  server.listen(PORT, HOST, () => {
    console.log(`Bloxd MCP website  http://localhost:${PORT}`)
    console.log(`MCP endpoint       http://localhost:${PORT}/mcp`)
    console.log(`stdio MCP          node server.js --stdio`)
  })
  return server
}

module.exports = { listen, PORT, HOST }
