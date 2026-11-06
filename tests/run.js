'use strict'

const assert = require('assert')
const path = require('path')
const fs = require('fs')
const { VoxelWorld, writeExportFiles } = require('../src/world')
const { MeshProject } = require('../src/mesh')
const { getSession } = require('../src/session')
const { callTool, TOOLS } = require('../src/tools')
const { handleMessage } = require('../src/mcp')
const catalog = require('../src/catalog')

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok  ' + name)
  } catch (err) {
    console.error('  FAIL  ' + name)
    console.error('       ' + (err.stack || err.message))
    process.exitCode = 1
  }
}

console.log('Bloxd MCP tests')

test('catalog resolves Stone and #RRGGBB', () => {
  const stone = catalog.resolveBlock('Stone')
  assert.strictEqual(stone.id, 28)
  assert.strictEqual(catalog.resolveBlock('stone').id, 28)
  assert.strictEqual(catalog.resolveBlock(15).name, 'Maple Wood Planks')
  const red = catalog.nearestColor('#a03333')
  assert.ok(red.best.name.toLowerCase().includes('red'))
})

test('fill box round-trips through .bloxdschem', () => {
  const world = new VoxelWorld()
  world.fillBox([0, 0, 0], [4, 3, 2], 28, false)
  assert.strictEqual(world.size, 5 * 4 * 3)
  const encoded = world.exportSchematic('Cube')
  assert.strictEqual(encoded.mode, 'single')
  assert.ok(encoded.bytes[0] === 0 && encoded.bytes[3] === 0)
  const parsed = global.BloxdSchemSplitter.parseSchematic(encoded.bytes)
  assert.strictEqual(parsed.voxels.size, 60)
  const decoded = global.BloxdSchematic.decodeSchematic(encoded.bytes)
  assert.strictEqual(decoded.blockCount, 60)
  assert.ok(decoded.voxels.get('0,0,0') === 28)
})

test('hollow box is a shell', () => {
  const world = new VoxelWorld()
  world.fillBox([0, 0, 0], [4, 4, 4], 15, true)
  assert.strictEqual(world.size, 5 * 5 * 5 - 3 * 3 * 3)
  assert.strictEqual(world.get(2, 2, 2), 0)
  assert.strictEqual(world.get(0, 0, 0), 15)
})

test('sphere, cylinder, line, pyramid place blocks', () => {
  const world = new VoxelWorld()
  world.fillSphere(0, 10, 0, 3, 4)
  world.fillCylinder(12, 0, 0, 2, 5, 28)
  world.drawLine([20, 0, 0], [24, 4, 0], 132)
  world.drawPyramid(30, 0, 0, 4, 4, 128)
  assert.ok(world.size > 40)
  assert.ok(world.get(0, 10, 0) === 4)
})

test('undo restores previous state', () => {
  const world = new VoxelWorld()
  world.fillBox([0, 0, 0], [1, 1, 1], 28)
  const n = world.size
  world.fillBox([5, 0, 0], [6, 1, 1], 15)
  assert.ok(world.size > n)
  world.undo()
  assert.strictEqual(world.size, n)
})

test('builds over 160 chunks split into valid parts', () => {
  const world = new VoxelWorld()
  world.set(0, 0, 0, 28)
  world.set(511, 0, 511, 15)
  const chunks = world.chunkCounts()
  assert.ok(chunks.total > 160, 'expected >160 chunks, got ' + chunks.total)
  const result = world.exportSchematic('Wide', { maxChunks: 160, allowSplit: true })
  assert.strictEqual(result.mode, 'split')
  assert.ok(result.parts >= 2)
  assert.ok(result.largestPart <= 160)
  assert.ok(result.zip && result.zip.length > 100)
  const schemFiles = result.files.filter(f => f.name.endsWith('.bloxdschem'))
  assert.ok(schemFiles.length >= 2)
  schemFiles.forEach(file => {
    const parsed = global.BloxdSchemSplitter.parseSchematic(file.data)
    assert.ok(parsed.voxels.size >= 1)
    assert.ok(/_part\d+_x-?\d+_z-?\d+/.test(file.name))
  })
  const dest = path.join(__dirname, '..', 'exports', 'test-split')
  const written = writeExportFiles(result, 'Wide', dest)
  assert.ok(fs.existsSync(written.zipPath))
  assert.ok(fs.existsSync(path.join(dest, 'GUIDE_IMPORTATION.txt')))
  assert.ok(fs.existsSync(path.join(dest, 'manifest.json')))
})

test('mesh world-code export uses attemptCreateMeshEntity', () => {
  const project = new MeshProject()
  project.name = 'Lantern'
  project.addPart({ type: 'BloxdBlock', block: 'Stone', x: 0, y: 1, z: 0, width: 1, height: 1, depth: 1 })
  project.addPart({ type: 'Box', color: '#ea7e35', x: 1.2, y: 0.4, z: 0, width: 2, height: 0.4, depth: 0.4 })
  const worldCode = project.exportCode({ mode: 'world', origin: [0, 8, 0] })
  assert.ok(worldCode.code.includes('attemptCreateMeshEntity'))
  assert.ok(worldCode.code.includes('onPlayerJoin'))
  assert.ok(worldCode.code.includes('BloxdBlock'))
  assert.ok(worldCode.code.includes('diffuseColor'))
  const blockCode = project.exportCode({ mode: 'codeblock' })
  assert.ok(blockCode.code.includes('thisPos'))
  assert.ok(blockCode.code.includes('getPlayerFacingInfo'))
})

test('MCP initialize, list tools, fill and export', async () => {
  const session = getSession('test-mcp')
  const init = await handleMessage(session, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
  })
  assert.strictEqual(init.result.serverInfo.name, 'bloxd-mcp')
  const listed = await handleMessage(session, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  assert.ok(listed.result.tools.length >= 40)
  assert.ok(listed.result.tools.some(t => t.name === 'export_schematic'))
  assert.ok(listed.result.tools.some(t => t.name === 'export_mesh_code'))
  const filled = await handleMessage(session, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'fill_box', arguments: { a: [0, 0, 0], b: [3, 2, 3], block: 'Stone Bricks' } }
  })
  const payload = JSON.parse(filled.result.content[0].text)
  assert.ok(payload.ok)
  assert.ok(payload.count > 0)
  const exported = callTool(session, 'export_schematic', { name: 'TestHouse' })
  assert.strictEqual(exported.mode, 'single')
  assert.ok(exported.files[0].name.endsWith('.bloxdschem'))
})

test('generate_structure castle writes official ids', () => {
  const session = getSession('test-castle')
  const result = callTool(session, 'generate_structure', { type: 'castle', size: 8, height: 6, seed: 'unit' })
  assert.ok(result.count > 20)
  assert.ok(session.world.size === result.total)
  const id = [...session.world.blocks.values()][0]
  assert.ok(catalog.ID_TO_NAME[id])
})

test('lookup_block searches catalog', () => {
  const session = getSession('test-lookup')
  const result = callTool(session, 'lookup_block', { query: 'quartz' })
  assert.ok(result.results.some(r => /quartz/i.test(r.name)))
})

test('tool schemas are unique and complete', () => {
  const names = TOOLS.map(t => t.name)
  assert.strictEqual(names.length, new Set(names).size)
  TOOLS.forEach(tool => {
    assert.ok(tool.description.length > 10)
    assert.ok(tool.inputSchema && tool.inputSchema.type === 'object')
  })
})

console.log(passed + ' passed')
if (process.exitCode) process.exit(process.exitCode)
