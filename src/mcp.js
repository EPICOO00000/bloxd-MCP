'use strict'

const { TOOLS, callTool } = require('./tools')
const { getSession } = require('./session')

const PROTOCOL = '2024-11-05'
const SERVER_INFO = { name: 'bloxd-mcp', version: '1.0.0' }

const INSTRUCTIONS = [
  'You are connected to Bloxd MCP. You can build Bloxd.io schematics and decorative meshes.',
  'SCHEMATICS: use fill_box, fill_sphere, fill_cylinder, draw_line, generate_structure, terrain_brush, etc.',
  'Coordinates are integer blocks. Y is up. Official block names (Stone, Maple Wood Planks, White Concrete, ...).',
  'Call lookup_block if you are unsure of a name. Prefer real Bloxd blocks, not made-up ones.',
  'When the build is done call export_schematic. If it is larger than 160 chunks it is split automatically into parts named name_part001_x0_z64.bloxdschem — tell the user to load every part at those offsets.',
  'MESHES: use mesh_add (BloxdBlock or coloured Box), then export_mesh_code. Output is JavaScript for Bloxd World Code (or a Code Block). Meshes are decorative entities, not terrain.',
  'Start with new_project, then build, then export. Use get_stats to check size/chunks as you go.'
].join(' ')

function mcpResult(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  return { content: [{ type: 'text', text }] }
}

function mcpError(message) {
  return { content: [{ type: 'text', text: 'Error: ' + message }], isError: true }
}

async function handleMessage(session, message) {
  if (!message || typeof message !== 'object') return null
  if (message.method && message.id == null) return null

  const id = message.id
  const method = message.method
  const params = message.params || {}

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params.protocolVersion || PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        }
      }
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} }
    }
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      }
    }
    if (method === 'tools/call') {
      const name = params.name
      const args = params.arguments || {}
      const data = callTool(session, name, args)
      session.emit('tool', { name, args, result: data })
      return { jsonrpc: '2.0', id, result: mcpResult(data) }
    }
    if (method === 'resources/list' || method === 'prompts/list') {
      return { jsonrpc: '2.0', id, result: { resources: [], prompts: [] } }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    }
  } catch (err) {
    if (method === 'tools/call') {
      return { jsonrpc: '2.0', id, result: mcpError(err.message || String(err)) }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: err.message || String(err) }
    }
  }
}

function writeStdio(message) {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, 'utf8')
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

function createStdioServer() {
  const session = getSession('stdio')
  let buf = Buffer.alloc(0)

  async function dispatch(raw) {
    let message
    try { message = JSON.parse(raw) } catch (_err) { return }
    if (Array.isArray(message)) {
      const responses = []
      for (const item of message) {
        const response = await handleMessage(session, item)
        if (response) responses.push(response)
      }
      if (responses.length) writeStdio(responses)
      return
    }
    const response = await handleMessage(session, message)
    if (response) writeStdio(response)
  }

  process.stdin.on('data', chunk => {
    buf = Buffer.concat([buf, chunk])
    while (true) {
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd >= 0) {
        const header = buf.slice(0, headerEnd).toString('utf8')
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (match) {
          const len = parseInt(match[1], 10)
          const start = headerEnd + 4
          if (buf.length < start + len) return
          const body = buf.slice(start, start + len).toString('utf8')
          buf = buf.slice(start + len)
          dispatch(body)
          continue
        }
      }
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl).toString('utf8').trim()
      buf = buf.slice(nl + 1)
      if (line.startsWith('{') || line.startsWith('[')) dispatch(line)
    }
  })
}

module.exports = { handleMessage, createStdioServer, PROTOCOL, SERVER_INFO, INSTRUCTIONS, mcpResult }
