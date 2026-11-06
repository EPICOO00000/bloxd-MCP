'use strict'

const catalog = require('./catalog')
const fs = require('fs')
const path = require('path')

const keyOf = (x, y, z) => `${x|0},${y|0},${z|0}`
const parseKey = key => key.split(',').map(Number)
const CHUNK = 32
const MAX_HISTORY = 40
const MAX_FILL = 1500000

class VoxelWorld {
  constructor() {
    this.blocks = new Map()
    this.selection = new Set()
    this.clipboard = []
    this.history = []
    this.historyIndex = -1
    this.name = 'Untitled Build'
    this.currentBlockId = 28
    this.commit('Empty world', true)
  }

  get size() { return this.blocks.size }

  has(x, y, z) { return this.blocks.has(keyOf(x, y, z)) }
  get(x, y, z) { return this.blocks.get(keyOf(x, y, z)) || 0 }
  set(x, y, z, id) {
    const key = keyOf(x, y, z)
    const n = Number(id) || 0
    if (n === 0) this.blocks.delete(key)
    else this.blocks.set(key, n)
    return key
  }
  delete(x, y, z) {
    return this.blocks.delete(keyOf(x, y, z))
  }

  snapshot() {
    return {
      blocks: new Map(this.blocks),
      selection: new Set(this.selection)
    }
  }

  commit(label = 'Edit', reset = false) {
    if (reset) {
      this.history = []
      this.historyIndex = -1
    }
    this.history.splice(this.historyIndex + 1)
    this.history.push({ label, ...this.snapshot() })
    if (this.history.length > MAX_HISTORY) this.history.shift()
    this.historyIndex = this.history.length - 1
    return label
  }

  undo() {
    if (this.historyIndex <= 0) return { ok: false, reason: 'Nothing to undo.' }
    this.historyIndex--
    const state = this.history[this.historyIndex]
    this.blocks = new Map(state.blocks)
    this.selection = new Set(state.selection)
    return { ok: true, label: state.label, blocks: this.size }
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return { ok: false, reason: 'Nothing to redo.' }
    this.historyIndex++
    const state = this.history[this.historyIndex]
    this.blocks = new Map(state.blocks)
    this.selection = new Set(state.selection)
    return { ok: true, label: state.label, blocks: this.size }
  }

  clear() {
    this.blocks.clear()
    this.selection.clear()
    this.clipboard = []
    this.commit('Clear world')
    return { blocks: 0 }
  }

  bounds() {
    if (!this.blocks.size) return null
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    this.blocks.forEach((_id, key) => {
      const [x, y, z] = parseKey(key)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    })
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      size: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1]
    }
  }

  chunkCounts() {
    const b = this.bounds()
    if (!b) return { x: 0, y: 0, z: 0, total: 0 }
    const x = Math.ceil(b.size[0] / CHUNK)
    const y = Math.ceil(b.size[1] / CHUNK)
    const z = Math.ceil(b.size[2] / CHUNK)
    return { x, y, z, total: x * y * z }
  }

  palette() {
    const counts = new Map()
    this.blocks.forEach(id => counts.set(id, (counts.get(id) || 0) + 1))
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({
        id,
        name: catalog.ID_TO_NAME[id] || `Block ${id}`,
        count,
        hex: catalog.hexString(id)
      }))
  }

  stats() {
    const b = this.bounds()
    const chunks = this.chunkCounts()
    return {
      name: this.name,
      blocks: this.size,
      bounds: b,
      chunks,
      overLimit: chunks.total > 160,
      partsNeeded: chunks.total <= 160 ? 1 : Math.ceil(chunks.total / 160),
      selected: this.selection.size,
      clipboard: this.clipboard.length,
      palette: this.palette().slice(0, 24),
      canUndo: this.historyIndex > 0,
      canRedo: this.historyIndex < this.history.length - 1
    }
  }

  assertBudget(extra) {
    if (this.blocks.size + extra > MAX_FILL) {
      throw new Error(`This operation would exceed the ${MAX_FILL.toLocaleString()}-block safety limit.`)
    }
  }

  fillBox(a, b, id, hollow = false) {
    const min = a.map((v, i) => Math.min(v | 0, b[i] | 0))
    const max = a.map((v, i) => Math.max(v | 0, b[i] | 0))
    const volume = (max[0] - min[0] + 1) * (max[1] - min[1] + 1) * (max[2] - min[2] + 1)
    if (!hollow) this.assertBudget(volume)
    let count = 0
    for (let x = min[0]; x <= max[0]; x++) {
      for (let y = min[1]; y <= max[1]; y++) {
        for (let z = min[2]; z <= max[2]; z++) {
          if (hollow && x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2]) continue
          this.set(x, y, z, id)
          count++
        }
      }
    }
    this.commit(hollow ? 'Hollow box' : 'Filled box')
    return { count, min, max }
  }

  fillSphere(cx, cy, cz, radius, id, hollow = false) {
    const r = Math.max(1, Math.round(radius))
    const inner = (r - 1) * (r - 1)
    const rr = r * r
    this.assertBudget(Math.ceil((4 / 3) * Math.PI * r * r * r))
    let count = 0
    for (let x = -r; x <= r; x++) {
      for (let y = -r; y <= r; y++) {
        for (let z = -r; z <= r; z++) {
          const d = x * x + y * y + z * z
          if (d > rr) continue
          if (hollow && d < inner) continue
          this.set(cx + x, cy + y, cz + z, id)
          count++
        }
      }
    }
    this.commit(hollow ? 'Hollow sphere' : 'Filled sphere')
    return { count, radius: r }
  }

  fillEllipsoid(cx, cy, cz, rx, ry, rz, id, hollow = false) {
    rx = Math.max(1, Math.round(rx))
    ry = Math.max(1, Math.round(ry))
    rz = Math.max(1, Math.round(rz))
    const innerX = Math.max(0.5, rx - 1)
    const innerY = Math.max(0.5, ry - 1)
    const innerZ = Math.max(0.5, rz - 1)
    let count = 0
    for (let x = -rx; x <= rx; x++) {
      for (let y = -ry; y <= ry; y++) {
        for (let z = -rz; z <= rz; z++) {
          const d = (x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz)
          if (d > 1) continue
          if (hollow && (x * x) / (innerX * innerX) + (y * y) / (innerY * innerY) + (z * z) / (innerZ * innerZ) < 1) continue
          this.set(cx + x, cy + y, cz + z, id)
          count++
        }
      }
    }
    this.commit(hollow ? 'Hollow ellipsoid' : 'Filled ellipsoid')
    return { count }
  }

  fillCylinder(cx, y0, cz, radius, height, id, hollow = false, axis = 'y') {
    const r = Math.max(1, Math.round(radius))
    const h = Math.max(1, Math.round(height))
    const inner = (r - 1) * (r - 1)
    let count = 0
    for (let i = 0; i < h; i++) {
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          const d = a * a + b * b
          if (d > r * r) continue
          if (hollow && d < inner && i > 0 && i < h - 1) continue
          let x, y, z
          if (axis === 'x') { x = y0 + i; y = cx + a; z = cz + b }
          else if (axis === 'z') { x = cx + a; y = cz + b; z = y0 + i }
          else { x = cx + a; y = y0 + i; z = cz + b }
          this.set(x, y, z, id)
          count++
        }
      }
    }
    this.commit(hollow ? 'Hollow cylinder' : 'Filled cylinder')
    return { count, radius: r, height: h }
  }

  drawLine(a, b, id, radius = 0) {
    const d = b.map((v, i) => (v | 0) - (a[i] | 0))
    const steps = Math.max(1, ...d.map(v => Math.abs(v)))
    let count = 0
    for (let i = 0; i <= steps; i++) {
      const p = a.map((v, j) => Math.round((v | 0) + d[j] * i / steps))
      if (radius > 0) {
        const r = Math.round(radius)
        for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
          if (x * x + y * y + z * z <= r * r) {
            this.set(p[0] + x, p[1] + y, p[2] + z, id)
            count++
          }
        }
      } else {
        this.set(p[0], p[1], p[2], id)
        count++
      }
    }
    this.commit('Line')
    return { count }
  }

  drawRing(cx, cy, cz, radius, id, thickness = 1, axis = 'y') {
    const r = Math.max(1, Number(radius))
    const t = Math.max(1, Math.round(thickness))
    const n = Math.max(16, Math.ceil(r * Math.PI * 3))
    let count = 0
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2
      const p = axis === 'x'
        ? [cx, cy + Math.cos(a) * r, cz + Math.sin(a) * r]
        : axis === 'z'
          ? [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz]
          : [cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r]
      const pr = Math.max(0, t - 1)
      for (let x = -pr; x <= pr; x++) for (let y = -pr; y <= pr; y++) for (let z = -pr; z <= pr; z++) {
        if (x * x + y * y + z * z <= pr * pr) {
          this.set(Math.round(p[0] + x), Math.round(p[1] + y), Math.round(p[2] + z), id)
          count++
        }
      }
    }
    this.commit('Ring')
    return { count }
  }

  drawCone(cx, y0, cz, radius, height, id) {
    const r = Math.max(1, Math.round(radius))
    const h = Math.max(1, Math.round(height))
    let count = 0
    for (let y = 0; y < h; y++) {
      const rr = Math.max(0, Math.round(r * (1 - y / h)))
      for (let x = -rr; x <= rr; x++) for (let z = -rr; z <= rr; z++) {
        if (x * x + z * z <= rr * rr) {
          this.set(cx + x, y0 + y, cz + z, id)
          count++
        }
      }
    }
    this.commit('Cone')
    return { count }
  }

  drawPyramid(cx, y0, cz, size, height, id, hollow = false) {
    const s = Math.max(1, Math.round(size))
    const h = Math.max(1, Math.round(height || s))
    let count = 0
    for (let y = 0; y < h; y++) {
      const t = 1 - y / h
      const half = Math.max(0, Math.round((s / 2) * t))
      for (let x = -half; x <= half; x++) for (let z = -half; z <= half; z++) {
        if (hollow && Math.abs(x) < half && Math.abs(z) < half && y < h - 1) continue
        this.set(cx + x, y0 + y, cz + z, id)
        count++
      }
    }
    this.commit(hollow ? 'Hollow pyramid' : 'Pyramid')
    return { count }
  }

  floodFill(x, y, z, id, limit = 100000) {
    const source = this.get(x, y, z)
    if (!source) return { count: 0, reason: 'Starting block is air.' }
    if (source === id) return { count: 0, reason: 'Already that block.' }
    const queue = [[x, y, z]]
    const seen = new Set()
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    let count = 0
    while (queue.length && count < limit) {
      const p = queue.shift()
      const k = keyOf(...p)
      if (seen.has(k)) continue
      seen.add(k)
      if (this.blocks.get(k) !== source) continue
      this.blocks.set(k, id)
      count++
      for (const d of dirs) queue.push([p[0] + d[0], p[1] + d[1], p[2] + d[2]])
    }
    this.commit('Flood fill')
    return { count }
  }

  replace(sourceId, targetId, region = null) {
    let count = 0
    const inside = region
      ? (x, y, z) => x >= region.min[0] && x <= region.max[0] && y >= region.min[1] && y <= region.max[1] && z >= region.min[2] && z <= region.max[2]
      : () => true
    this.blocks.forEach((id, key) => {
      if (id !== sourceId) return
      const p = parseKey(key)
      if (!inside(...p)) return
      this.blocks.set(key, targetId)
      count++
    })
    this.commit('Replace blocks')
    return { count }
  }

  removeRegion(a, b) {
    const min = a.map((v, i) => Math.min(v | 0, b[i] | 0))
    const max = a.map((v, i) => Math.max(v | 0, b[i] | 0))
    let count = 0
    for (let x = min[0]; x <= max[0]; x++) {
      for (let y = min[1]; y <= max[1]; y++) {
        for (let z = min[2]; z <= max[2]; z++) {
          if (this.delete(x, y, z)) count++
        }
      }
    }
    this.commit('Remove region')
    return { count, min, max }
  }

  selectBox(a, b, additive = false) {
    if (!additive) this.selection.clear()
    const min = a.map((v, i) => Math.min(v | 0, b[i] | 0))
    const max = a.map((v, i) => Math.max(v | 0, b[i] | 0))
    this.blocks.forEach((_id, key) => {
      const p = parseKey(key)
      if (p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2]) {
        this.selection.add(key)
      }
    })
    return { selected: this.selection.size }
  }

  selectConnected(x, y, z, additive = false, limit = 100000) {
    const source = this.get(x, y, z)
    if (!source) return { selected: this.selection.size }
    if (!additive) this.selection.clear()
    const q = [[x, y, z]]
    const seen = new Set()
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    while (q.length && seen.size < limit) {
      const p = q.shift()
      const k = keyOf(...p)
      if (seen.has(k) || this.blocks.get(k) !== source) continue
      seen.add(k)
      this.selection.add(k)
      for (const d of dirs) q.push([p[0] + d[0], p[1] + d[1], p[2] + d[2]])
    }
    return { selected: this.selection.size }
  }

  copySelection() {
    if (!this.selection.size) return { count: 0 }
    const points = [...this.selection].map(key => ({ p: parseKey(key), id: this.blocks.get(key) }))
    const min = [0, 1, 2].map(i => Math.min(...points.map(item => item.p[i])))
    this.clipboard = points.map(item => ({ offset: item.p.map((v, i) => v - min[i]), id: item.id }))
    return { count: this.clipboard.length }
  }

  cutSelection() {
    const copied = this.copySelection()
    let count = 0
    this.selection.forEach(key => {
      if (this.blocks.delete(key)) count++
    })
    this.selection.clear()
    this.commit('Cut')
    return { copied: copied.count, removed: count }
  }

  paste(origin) {
    if (!this.clipboard.length) return { count: 0 }
    this.clipboard.forEach(item => {
      this.set(origin[0] + item.offset[0], origin[1] + item.offset[1], origin[2] + item.offset[2], item.id)
    })
    this.commit('Paste')
    return { count: this.clipboard.length }
  }

  deleteSelection() {
    let count = 0
    this.selection.forEach(key => {
      if (this.blocks.delete(key)) count++
    })
    this.selection.clear()
    this.commit('Delete selection')
    return { count }
  }

  transformSelection(mapper, label) {
    if (!this.selection.size) return { count: 0 }
    const items = [...this.selection].map(key => ({ p: parseKey(key), id: this.blocks.get(key) }))
    items.forEach(item => this.blocks.delete(keyOf(...item.p)))
    this.selection.clear()
    items.forEach(item => {
      const p = mapper(item.p)
      this.selection.add(this.set(p[0], p[1], p[2], item.id))
    })
    this.commit(label)
    return { count: items.length }
  }

  moveSelection(dx, dy, dz) {
    return this.transformSelection(p => [p[0] + dx, p[1] + dy, p[2] + dz], 'Move selection')
  }

  rotateSelection(axis = 'y', clockwise = true) {
    if (!this.selection.size) return { count: 0 }
    const points = [...this.selection].map(parseKey)
    const center = [0, 1, 2].map(i => (Math.min(...points.map(p => p[i])) + Math.max(...points.map(p => p[i]))) / 2)
    return this.transformSelection(p => {
      const q = p.map((v, i) => v - center[i])
      let r
      if (axis === 'x') r = [q[0], clockwise ? -q[2] : q[2], clockwise ? q[1] : -q[1]]
      else if (axis === 'z') r = [clockwise ? -q[1] : q[1], clockwise ? q[0] : -q[0], q[2]]
      else r = [clockwise ? -q[2] : q[2], q[1], clockwise ? q[0] : -q[0]]
      return r.map((v, i) => Math.round(v + center[i]))
    }, `Rotate ${axis.toUpperCase()}`)
  }

  mirrorSelection(axis = 'x') {
    if (!this.selection.size) return { count: 0 }
    const points = [...this.selection].map(parseKey)
    const i = { x: 0, y: 1, z: 2 }[axis]
    const center = (Math.min(...points.map(p => p[i])) + Math.max(...points.map(p => p[i]))) / 2
    return this.transformSelection(p => p.map((v, j) => j === i ? Math.round(center - (v - center)) : v), `Mirror ${axis.toUpperCase()}`)
  }

  hollowSelection() {
    if (!this.selection.size) return { count: 0 }
    const selected = new Set(this.selection)
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const remove = []
    selected.forEach(key => {
      const p = parseKey(key)
      if (dirs.every(d => selected.has(keyOf(p[0] + d[0], p[1] + d[1], p[2] + d[2])))) remove.push(key)
    })
    remove.forEach(key => {
      this.blocks.delete(key)
      this.selection.delete(key)
    })
    this.commit('Hollow')
    return { count: remove.length }
  }

  dilateSelection() {
    if (!this.selection.size) return { count: 0 }
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const add = new Map()
    this.selection.forEach(key => {
      const p = parseKey(key)
      const id = this.blocks.get(key)
      dirs.forEach(d => {
        const k = keyOf(p[0] + d[0], p[1] + d[1], p[2] + d[2])
        if (!this.blocks.has(k)) add.set(k, id)
      })
    })
    add.forEach((id, key) => {
      this.blocks.set(key, id)
      this.selection.add(key)
    })
    this.commit('Dilate')
    return { count: add.size }
  }

  erodeSelection() {
    if (!this.selection.size) return { count: 0 }
    const selected = new Set(this.selection)
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const remove = []
    selected.forEach(key => {
      const p = parseKey(key)
      if (dirs.some(d => !selected.has(keyOf(p[0] + d[0], p[1] + d[1], p[2] + d[2])))) remove.push(key)
    })
    remove.forEach(key => {
      this.blocks.delete(key)
      this.selection.delete(key)
    })
    this.commit('Erode')
    return { count: remove.length }
  }

  smoothSelection() {
    if (!this.selection.size) return { count: 0 }
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    const changes = []
    this.selection.forEach(key => {
      const p = parseKey(key)
      const counts = new Map()
      dirs.forEach(d => {
        const id = this.get(p[0] + d[0], p[1] + d[1], p[2] + d[2])
        if (id) counts.set(id, (counts.get(id) || 0) + 1)
      })
      const best = [...counts].sort((a, b) => b[1] - a[1])[0]
      if (best && best[1] >= 3) changes.push([key, best[0]])
    })
    changes.forEach(([key, id]) => this.blocks.set(key, id))
    this.commit('Smooth materials')
    return { count: changes.length }
  }

  extrudeSelection(dx = 0, dy = 1, dz = 0) {
    if (!this.selection.size) return { count: 0 }
    const source = [...this.selection].map(key => ({ p: parseKey(key), id: this.blocks.get(key) }))
    const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz), 1)
    const created = []
    for (let n = 1; n <= steps; n++) {
      source.forEach(item => {
        const p = [
          item.p[0] + Math.round(dx * n / steps),
          item.p[1] + Math.round(dy * n / steps),
          item.p[2] + Math.round(dz * n / steps)
        ]
        created.push(this.set(...p, item.id))
      })
    }
    this.selection = new Set(created)
    this.commit('Extrude')
    return { count: created.length }
  }

  applyTexture(options = {}) {
    const engine = global.BloxdTextureEngine
    const palette = options.palette || []
    const keys = options.surface
      ? engine.surfaceKeys(this.blocks, options.selection ? this.selection : null)
      : (options.selection ? [...this.selection] : [...this.blocks.keys()])
    const result = engine.apply(this.blocks, keys, palette, options)
    this.commit('Apply texture')
    return result
  }

  terrainBrush(center, options = {}) {
    const changed = global.BloxdTerrainBrush.apply(this, center, options)
    this.commit(`Terrain ${options.tool || 'biome'}`)
    return { count: changed.size }
  }

  generate(type, params = {}, options = {}) {
    const layer = { type, seed: params.seed || Date.now(), size: params.size || 12, height: params.height || 8, ...params }
    const writer = global.BloxdProceduralGenerators.localGenerate(layer, {
      blocksPerUnit: options.blocksPerUnit || 2,
      maxBlocks: options.maxBlocks || MAX_FILL
    })
    const ox = Number(options.x) || 0
    const oy = Number(options.y) || 0
    const oz = Number(options.z) || 0
    writer.blocks.forEach((id, k) => {
      const [x, y, z] = parseKey(k)
      this.set(x + ox, y + oy, z + oz, id)
    })
    this.commit(`Generate ${type}`)
    return { count: writer.blocks.size, clipped: writer.clipped, type }
  }

  toVoxelMap() {
    return new Map(this.blocks)
  }

  loadMap(map, label = 'Load') {
    this.blocks = map instanceof Map ? new Map(map) : new Map()
    this.selection.clear()
    this.commit(label, true)
    return { blocks: this.size }
  }

  exportSchematic(name, options = {}) {
    const splitter = global.BloxdSchemSplitter
    const result = splitter.encodeVoxelMapForBloxd(this.blocks, {
      name: name || this.name || 'Bloxd Build',
      maxChunks: options.maxChunks || 160,
      allowSplit: options.allowSplit !== false
    })
    return result
  }

  importSchematic(bytes, filename) {
    const parsed = global.BloxdSchemSplitter.parseSchematic(bytes)
    const map = parsed.voxels.toStringMap()
    const offset = filename ? global.BloxdSchemSplitter.parseOffsetsFromName(filename) : null
    if (offset) {
      const shifted = new Map()
      map.forEach((id, key) => {
        const [x, y, z] = parseKey(key)
        shifted.set(keyOf(x + offset.x, y + offset.y, z + offset.z), id)
      })
      shifted.forEach((id, key) => this.blocks.set(key, id))
    } else {
      map.forEach((id, key) => this.blocks.set(key, id))
    }
    this.commit('Import schematic')
    return { name: parsed.name, blocks: parsed.stats.blocks, total: this.size }
  }

  serializeBlocks(limit = 80000) {
    const out = []
    for (const [key, id] of this.blocks) {
      if (out.length >= limit) break
      const [x, y, z] = parseKey(key)
      out.push(x, y, z, id)
    }
    return { packed: out, truncated: this.blocks.size > limit, count: this.blocks.size }
  }
}

function writeExportFiles(result, name, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const base = String(name || 'build').replace(/[^\w.\-]+/g, '_') || 'build'
  const files = []
  if (result.mode === 'single') {
    const fileName = base.endsWith('.bloxdschem') ? base : `${base}.bloxdschem`
    const filePath = path.join(destDir, fileName)
    fs.writeFileSync(filePath, Buffer.from(result.bytes))
    files.push({ name: fileName, path: filePath, bytes: result.bytes.length, chunks: result.chunks })
    return { ...result, files, zipPath: null }
  }
  const zipName = `${base}.zip`
  const zipPath = path.join(destDir, zipName)
  fs.writeFileSync(zipPath, Buffer.from(result.zip))
  result.files.forEach(entry => {
    if (!entry.name.endsWith('.bloxdschem')) return
    const filePath = path.join(destDir, entry.name)
    fs.writeFileSync(filePath, Buffer.from(entry.data))
    files.push({
      name: entry.name,
      path: filePath,
      bytes: entry.data.length,
      offset: entry.offset,
      chunks: entry.chunks
    })
  })
  const guide = result.files.find(entry => entry.name === 'GUIDE_IMPORTATION.txt')
  const manifest = result.files.find(entry => entry.name === 'manifest.json')
  if (guide) fs.writeFileSync(path.join(destDir, 'GUIDE_IMPORTATION.txt'), Buffer.from(guide.data))
  if (manifest) fs.writeFileSync(path.join(destDir, 'manifest.json'), Buffer.from(manifest.data))
  return { ...result, files, zipPath, zipName }
}

module.exports = { VoxelWorld, keyOf, parseKey, writeExportFiles, CHUNK }
