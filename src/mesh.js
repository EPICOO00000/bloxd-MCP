'use strict'

const catalog = require('./catalog')

let seq = 1
const nextId = () => 'p' + (seq++)

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000
}

function snap90(deg) {
  const n = ((Number(deg) || 0) % 360 + 360) % 360
  return Math.round(n / 90) * 90 % 360
}

class MeshProject {
  constructor() {
    this.name = 'Untitled Mesh'
    this.parts = []
    this.origin = [0, 0, 0]
    this.clearance = 4
    this.history = []
    this.historyIndex = -1
    this.commit('Empty mesh', true)
  }

  snapshot() {
    return JSON.parse(JSON.stringify({ name: this.name, parts: this.parts, origin: this.origin, clearance: this.clearance }))
  }

  commit(label, reset = false) {
    if (reset) {
      this.history = []
      this.historyIndex = -1
    }
    this.history.splice(this.historyIndex + 1)
    this.history.push({ label, state: this.snapshot() })
    if (this.history.length > 40) this.history.shift()
    this.historyIndex = this.history.length - 1
  }

  restore(state) {
    this.name = state.name
    this.parts = state.parts
    this.origin = state.origin
    this.clearance = state.clearance
  }

  undo() {
    if (this.historyIndex <= 0) return { ok: false }
    this.historyIndex--
    this.restore(this.history[this.historyIndex].state)
    return { ok: true, label: this.history[this.historyIndex].label, parts: this.parts.length }
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return { ok: false }
    this.historyIndex++
    this.restore(this.history[this.historyIndex].state)
    return { ok: true, label: this.history[this.historyIndex].label, parts: this.parts.length }
  }

  clear() {
    this.parts = []
    this.commit('Clear mesh')
  }

  addPart(input = {}) {
    const type = input.type === 'Box' || input.type === 'box' ? 'Box' : 'BloxdBlock'
    const part = {
      id: input.id || nextId(),
      type,
      x: round3(input.x || 0),
      y: round3(input.y || 0),
      z: round3(input.z || 0),
      width: Math.max(0.05, round3(input.width ?? input.size ?? 1)),
      height: Math.max(0.05, round3(input.height ?? input.size ?? 1)),
      depth: Math.max(0.05, round3(input.depth ?? input.size ?? 1)),
      yaw: snap90(input.yaw || input.rotation || 0),
      name: input.name || ''
    }
    if (type === 'Box') {
      const color = parseColor(input.color || input.diffuseColor || '#f2f2f2')
      part.color = color
      if (input.emissive || input.emissiveColor) part.emissive = parseColor(input.emissive || input.emissiveColor)
      if (input.texture) part.texture = String(input.texture)
    } else {
      const block = catalog.resolveBlock(input.block || input.blockName || 'Stone')
      part.blockName = block.name
      part.blockId = block.id
    }
    this.parts.push(part)
    this.commit('Add part')
    return part
  }

  get(id) {
    const part = this.parts.find(item => item.id === id)
    if (!part) throw new Error(`No mesh part "${id}".`)
    return part
  }

  update(id, patch = {}) {
    const part = this.get(id)
    if (patch.x != null) part.x = round3(patch.x)
    if (patch.y != null) part.y = round3(patch.y)
    if (patch.z != null) part.z = round3(patch.z)
    if (patch.width != null) part.width = Math.max(0.05, round3(patch.width))
    if (patch.height != null) part.height = Math.max(0.05, round3(patch.height))
    if (patch.depth != null) part.depth = Math.max(0.05, round3(patch.depth))
    if (patch.size != null) {
      const s = Math.max(0.05, round3(patch.size))
      part.width = part.height = part.depth = s
    }
    if (patch.yaw != null || patch.rotation != null) part.yaw = snap90(patch.yaw != null ? patch.yaw : patch.rotation)
    if (patch.name != null) part.name = String(patch.name)
    if (part.type === 'Box') {
      if (patch.color || patch.diffuseColor) part.color = parseColor(patch.color || patch.diffuseColor)
      if (patch.emissive || patch.emissiveColor) part.emissive = parseColor(patch.emissive || patch.emissiveColor)
      if (patch.texture != null) part.texture = patch.texture ? String(patch.texture) : undefined
    } else if (patch.block || patch.blockName) {
      const block = catalog.resolveBlock(patch.block || patch.blockName)
      part.blockName = block.name
      part.blockId = block.id
    }
    this.commit('Update part')
    return part
  }

  remove(id) {
    const index = this.parts.findIndex(item => item.id === id)
    if (index < 0) throw new Error(`No mesh part "${id}".`)
    const [removed] = this.parts.splice(index, 1)
    this.commit('Remove part')
    return removed
  }

  duplicate(id, offset = [1, 0, 0]) {
    const src = this.get(id)
    const copy = JSON.parse(JSON.stringify(src))
    copy.id = nextId()
    copy.x = round3(src.x + (offset[0] || 0))
    copy.y = round3(src.y + (offset[1] || 0))
    copy.z = round3(src.z + (offset[2] || 0))
    this.parts.push(copy)
    this.commit('Duplicate part')
    return copy
  }

  stats() {
    const b = this.bounds()
    return {
      name: this.name,
      parts: this.parts.length,
      boxes: this.parts.filter(p => p.type === 'Box').length,
      blocks: this.parts.filter(p => p.type === 'BloxdBlock').length,
      bounds: b,
      origin: this.origin,
      clearance: this.clearance
    }
  }

  bounds() {
    if (!this.parts.length) return null
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    this.parts.forEach(part => {
      const { width, height, depth } = orientedSize(part)
      minX = Math.min(minX, part.x - width / 2)
      minY = Math.min(minY, part.y - height / 2)
      minZ = Math.min(minZ, part.z - depth / 2)
      maxX = Math.max(maxX, part.x + width / 2)
      maxY = Math.max(maxY, part.y + height / 2)
      maxZ = Math.max(maxZ, part.z + depth / 2)
    })
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
  }

  list() {
    return this.parts.map(part => ({ ...part }))
  }

  exportCode(options = {}) {
    return exportMeshCode(this, options)
  }
}

function orientedSize(part) {
  const yaw = snap90(part.yaw)
  if (yaw === 90 || yaw === 270) return { width: part.depth, height: part.height, depth: part.width }
  return { width: part.width, height: part.height, depth: part.depth }
}

function parseColor(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map(n => Math.max(0, Math.min(255, Math.round(Number(n)))))
  }
  const text = String(value || '#f2f2f2').replace('#', '')
  if (/^[0-9a-f]{6}$/i.test(text)) {
    const hex = parseInt(text, 16)
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  }
  const named = {
    white: [242, 242, 242], black: [20, 20, 24], red: [160, 51, 51], green: [77, 138, 51],
    blue: [60, 84, 173], yellow: [184, 169, 58], orange: [234, 126, 53], purple: [128, 77, 186],
    gold: [243, 208, 74], iron: [212, 212, 212], diamond: [99, 216, 232]
  }
  if (named[String(value).toLowerCase()]) return named[String(value).toLowerCase()]
  throw new Error(`Cannot parse color "${value}". Use #RRGGBB or [r,g,b].`)
}

function ident(name) {
  return String(name || 'Mesh').replace(/[^\w]+/g, '_').replace(/^(\d)/, '_$1') || 'Mesh'
}

function jsNum(n) {
  const v = round3(n)
  return Number.isInteger(v) ? String(v) : String(v)
}

function jsArr(arr) {
  return '[' + arr.map(jsNum).join(', ') + ']'
}

function exportMeshCode(project, options = {}) {
  const mode = options.mode === 'codeblock' ? 'codeblock' : 'world'
  const origin = options.origin || project.origin || [0, 0, 0]
  const clearance = Math.max(1, Math.min(32, Number(options.clearance != null ? options.clearance : project.clearance) || 4))
  const tag = ident(options.name || project.name || 'Mesh')
  const minY = project.parts.reduce((m, p) => Math.min(m, p.y - orientedSize(p).height / 2), 0)

  const lines = []
  if (mode === 'world') {
    lines.push(`// Bloxd MCP mesh — paste into World Code.`)
    lines.push(`// Spawns once when the first player joins. Change ORIGIN to place it.`)
    lines.push(`var ORIGIN_${tag} = ${jsArr(origin)};`)
    lines.push(`var spawned_${tag} = false;`)
    lines.push(`function spawn_${tag}(ox, oy, oz) {`)
  } else {
    lines.push(`// Bloxd MCP mesh — paste into a Code Block, then right-click it.`)
    lines.push(`// The model appears in the direction you face, standing on the ground.`)
    lines.push(`var _pos = thisPos;`)
    lines.push(`var _info = api.getPlayerFacingInfo(myId);`)
    lines.push(`var _dir = _info && _info.dir ? _info.dir : [0, 0, 1];`)
    lines.push(`var ox = _pos[0] + _dir[0] * ${clearance};`)
    lines.push(`var oy = _pos[1];`)
    lines.push(`var oz = _pos[2] + _dir[2] * ${clearance};`)
    lines.push(`(function spawn_${tag}(ox, oy, oz) {`)
  }

  lines.push(`  function _mesh(type, opts, x, y, z) {`)
  lines.push(`    var id = api.attemptCreateMeshEntity(type, opts);`)
  lines.push(`    if (id) api.setPosition(id, ox + x, oy + y, oz + z);`)
  lines.push(`    return id;`)
  lines.push(`  }`)

  project.parts.forEach((part, index) => {
    const size = orientedSize(part)
    const x = round3(part.x)
    const y = round3(part.y - minY)
    const z = round3(part.z)
    if (part.type === 'Box') {
      const opts = [
        `width: ${jsNum(size.width)}`,
        `height: ${jsNum(size.height)}`,
        `depth: ${jsNum(size.depth)}`,
        `diffuseColor: ${jsArr(part.color || [242, 242, 242])}`
      ]
      if (part.emissive) opts.push(`emissiveColor: ${jsArr(part.emissive)}`)
      if (part.texture) opts.push(`texture: ${JSON.stringify(part.texture)}`)
      lines.push(`  _mesh("Box", { ${opts.join(', ')} }, ${jsNum(x)}, ${jsNum(y)}, ${jsNum(z)});`)
    } else {
      const sizeLit = (size.width === size.height && size.height === size.depth)
        ? jsNum(size.width)
        : jsArr([size.width, size.height, size.depth])
      lines.push(`  _mesh("BloxdBlock", { blockName: ${JSON.stringify(part.blockName)}, size: ${sizeLit} }, ${jsNum(x)}, ${jsNum(y)}, ${jsNum(z)});`)
    }
    if (index === 0 && part.name) lines.push(`  // ${part.name}`)
  })

  if (mode === 'world') {
    lines.push(`}`)
    lines.push(`function onPlayerJoin(playerId) {`)
    lines.push(`  if (spawned_${tag}) return;`)
    lines.push(`  spawned_${tag} = true;`)
    lines.push(`  spawn_${tag}(ORIGIN_${tag}[0], ORIGIN_${tag}[1], ORIGIN_${tag}[2]);`)
    lines.push(`}`)
  } else {
    lines.push(`})(ox, oy, oz);`)
  }

  const code = lines.join('\n') + '\n'
  return {
    mode,
    name: project.name,
    parts: project.parts.length,
    code,
    filename: `${tag}-${mode}.js`
  }
}

module.exports = { MeshProject, exportMeshCode, parseColor }
