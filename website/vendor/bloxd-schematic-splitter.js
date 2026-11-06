/*
 * Bloxd schematic splitter — core (DOM-free).
 * ---------------------------------------------------------------------------
 * Imports one or more .bloxdschem files, detects the separate buildings /
 * objects inside them and re-encodes every detected unit as its own valid
 * .bloxdschem file (plus a ZIP bundle with a Bloxd manifest.json).
 *
 * The detection and splitting approach is adapted from the Apache-2.0 project
 *   https://github.com/Souls-equal/Bloxd_Map_Editor  (schem_splitter.js, V6.4.1)
 * Reimplemented here without Babylon.js / JSZip so it can run in VoxelForge,
 * inside Node tests, and fully offline.
 *
 * Format facts used below (Bloxd):
 *   - 4 leading zero bytes, then an Avro-encoded header
 *   - zig-zag Avro ints, length-prefixed strings/bytes
 *   - 32 x 32 x 32 chunks, block index = x * 1024 + y * 32 + z
 *   - every chunk is run-length encoded as (runLength, blockId) uvarint pairs
 *
 * Everything in this module is plain JavaScript (no DOM) so `tests/`
 * can require() it directly.
 */
(function (global) {
  'use strict'

  const CHUNK = 32
  const CHUNK_VOLUME = CHUNK * CHUNK * CHUNK
  const AIR = 0
  const MAX_BLOCKS = 3000000
  const SMALL_UNIT_BLOCKS = 100
  // Bloxd refuses a schematic above 160 chunks: bigger builds must be exported
  // as several parts loaded next to each other.
  const MAX_CHUNKS_PER_FILE = 160
  const GOLDEN_ANGLE = 137.508

  /* ------------------------------------------------------------------ *
   * Low-level Avro / uvarint helpers
   * ------------------------------------------------------------------ */

  function readUvarint(bytes, cursor) {
    let value = 0
    let shift = 1
    for (let index = 0; index < 10; index++) {
      if (cursor.value >= bytes.length) throw new Error('Unexpected end of schematic data.')
      const byte = bytes[cursor.value++]
      value += (byte & 0x7f) * shift
      if (!(byte & 0x80)) return value
      shift *= 128
    }
    throw new Error('Schematic varint is too long.')
  }

  function readAvroInt(bytes, cursor) {
    const encoded = readUvarint(bytes, cursor)
    return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2
  }

  function readAvroBytes(bytes, cursor) {
    const length = readAvroInt(bytes, cursor)
    if (length < 0 || cursor.value + length > bytes.length) throw new Error('Invalid schematic byte field.')
    const value = bytes.subarray(cursor.value, cursor.value + length)
    cursor.value += length
    return value
  }

  function readAvroString(bytes, cursor) {
    if (typeof TextDecoder === 'undefined') throw new Error('TextDecoder is required to read schematics.')
    return new TextDecoder().decode(readAvroBytes(bytes, cursor))
  }

  /** Growable little-endian writer used by the encoder and the ZIP writer. */
  class ByteWriter {
    constructor(capacity) {
      this.buffer = new Uint8Array(Math.max(64, capacity || 1024))
      this.length = 0
    }

    ensure(extra) {
      const needed = this.length + extra
      if (needed <= this.buffer.length) return
      let capacity = this.buffer.length * 2
      while (capacity < needed) capacity *= 2
      const next = new Uint8Array(capacity)
      next.set(this.buffer.subarray(0, this.length))
      this.buffer = next
    }

    u8(value) {
      this.ensure(1)
      this.buffer[this.length++] = value & 0xff
    }

    u16(value) {
      this.ensure(2)
      this.buffer[this.length++] = value & 0xff
      this.buffer[this.length++] = (value >>> 8) & 0xff
    }

    u32(value) {
      this.ensure(4)
      this.buffer[this.length++] = value & 0xff
      this.buffer[this.length++] = (value >>> 8) & 0xff
      this.buffer[this.length++] = (value >>> 16) & 0xff
      this.buffer[this.length++] = (value >>> 24) & 0xff
    }

    uvarint(value) {
      let remaining = Math.max(0, Math.floor(value))
      while (remaining >= 0x80) {
        this.u8((remaining & 0x7f) | 0x80)
        remaining = Math.floor(remaining / 128)
      }
      this.u8(remaining & 0x7f)
    }

    avroInt(value) {
      const number = Math.floor(value)
      this.uvarint(number < 0 ? -number * 2 - 1 : number * 2)
    }

    bytes(data) {
      this.ensure(data.length)
      this.buffer.set(data, this.length)
      this.length += data.length
    }

    avroBytes(data) {
      this.avroInt(data.length)
      this.bytes(data)
    }

    avroString(text) {
      const encoded = new TextEncoder().encode(text)
      this.avroInt(encoded.length)
      this.bytes(encoded)
    }

    result() {
      return this.buffer.slice(0, this.length)
    }
  }

  /* ------------------------------------------------------------------ *
   * VoxelSet — compact voxel storage on linear integer keys
   * ------------------------------------------------------------------ */

  /**
   * Blocks are normalised to a 0-based box. Each coordinate maps to a single
   * integer key, which keeps neighbour tests, detection and encoding cheap
   * (no string concatenation per lookup).
   */
  class VoxelSet {
    constructor(sx, sy, sz, blocks) {
      this.sx = Math.max(0, sx | 0)
      this.sy = Math.max(0, sy | 0)
      this.sz = Math.max(0, sz | 0)
      this.blocks = blocks || new Map()
    }

    get size() {
      return this.blocks.size
    }

    get plane() {
      return this.sx * this.sy
    }

    get extent() {
      return {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: Math.max(-1, this.sx - 1),
        maxY: Math.max(-1, this.sy - 1),
        maxZ: Math.max(-1, this.sz - 1)
      }
    }

    key(x, y, z) {
      return x + y * this.sx + z * this.sx * this.sy
    }

    decode(key) {
      const plane = this.sx * this.sy
      const z = Math.floor(key / plane)
      const rest = key - z * plane
      const y = Math.floor(rest / this.sx)
      return [rest - y * this.sx, y, z]
    }

    get(x, y, z) {
      return this.blocks.get(this.key(x, y, z))
    }

    has(x, y, z) {
      return this.blocks.has(this.key(x, y, z))
    }

    set(x, y, z, id) {
      this.blocks.set(this.key(x, y, z), id)
    }

    clone() {
      return new VoxelSet(this.sx, this.sy, this.sz, new Map(this.blocks))
    }

    /** Build from the `x,y,z` -> blockId maps used elsewhere in VoxelForge (normalised to 0). */
    static fromStringMap(map) {
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      map.forEach((_id, key) => {
        const [x, y, z] = key.split(',').map(Number)
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      })
      if (!Number.isFinite(minX)) return new VoxelSet(0, 0, 0)
      const voxels = new VoxelSet(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1)
      map.forEach((id, key) => {
        const [x, y, z] = key.split(',').map(Number)
        voxels.set(x - minX, y - minY, z - minZ, id)
      })
      return voxels
    }

    toStringMap() {
      const result = new Map()
      this.blocks.forEach((id, key) => {
        const [x, y, z] = this.decode(key)
        result.set(`${x},${y},${z}`, id)
      })
      return result
    }

    /**
     * Adopt a `x,y,z` -> blockId map such as the editor's voxel world.
     * Coordinates may be negative (the 3D voxelizer works in world space), so
     * the result is normalised to a zero-based box.
     */
    adoptStringMap(map) {
      if (!map || !map.size) return new VoxelSet(0, 0, 0)
      const count = map.size
      const coords = new Int32Array(count * 3)
      const ids = new Uint16Array(count)
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      let index = 0
      map.forEach((id, key) => {
        const [x, y, z] = key.split(',').map(Number)
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          throw new Error('Invalid voxel coordinate: ' + key)
        }
        coords[index] = x
        coords[index + 1] = y
        coords[index + 2] = z
        ids[index / 3] = id
        index += 3
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      })
      const voxels = new VoxelSet(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1)
      const plane = voxels.sx * voxels.sy
      for (let block = 0; block < count; block++) {
        const x = coords[block * 3] - minX
        const y = coords[block * 3 + 1] - minY
        const z = coords[block * 3 + 2] - minZ
        voxels.blocks.set(x + y * voxels.sx + z * plane, ids[block])
      }
      return voxels
    }
  }

  /* ------------------------------------------------------------------ *
   * Decoding
   * ------------------------------------------------------------------ */

  function decodeChunkInto(rle, target) {
    target.fill(AIR)
    const cursor = { value: 0 }
    let index = 0
    while (index < CHUNK_VOLUME) {
      if (cursor.value >= rle.length) throw new Error('Schematic chunk data ended early.')
      const runLength = readUvarint(rle, cursor)
      if (runLength <= 0) throw new Error('Schematic contains a zero-length block run.')
      if (cursor.value >= rle.length) throw new Error('Schematic chunk data ended early.')
      const id = readUvarint(rle, cursor)
      const end = Math.min(CHUNK_VOLUME, index + runLength)
      target.fill(id, index, end)
      index = end
    }
    return target
  }

  /**
   * Decode a .bloxdschem. Multiple block groups in one file are merged, exactly
   * like the upstream splitter does.
   */
  function parseSchematic(input, options) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    const settings = options || {}
    if (!bytes.length) throw new Error('The schematic file is empty.')
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      throw new Error('This is a gzip-compressed file (Minecraft .schem / .litematic). Convert it to .bloxdschem first.')
    }
    if (bytes.length < 12) throw new Error('This file is too small to be a .bloxdschem.')

    const cursor = { value: 0 }
    let zeroBytes = 0
    while (zeroBytes < 4 && bytes[cursor.value] === 0) {
      cursor.value++
      zeroBytes++
    }
    if (zeroBytes === 0) throw new Error('Missing the 4-byte Bloxd schematic header. Is this really a .bloxdschem?')

    const name = readAvroString(bytes, cursor)
    const position = {
      x: readAvroInt(bytes, cursor),
      y: readAvroInt(bytes, cursor),
      z: readAvroInt(bytes, cursor)
    }
    const declaredSize = {
      x: readAvroInt(bytes, cursor),
      y: readAvroInt(bytes, cursor),
      z: readAvroInt(bytes, cursor)
    }

    let capacity = 4096
    let coords = new Int32Array(capacity * 4)
    let count = 0
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    const scratch = new Int32Array(CHUNK_VOLUME)
    let chunks = 0
    let groups = 0
    let declaredBlocks = 0

    const pushBlock = (x, y, z, id) => {
      if (count >= capacity) {
        capacity *= 2
        const next = new Int32Array(capacity * 4)
        next.set(coords)
        coords = next
      }
      const base = count * 4
      coords[base] = x
      coords[base + 1] = y
      coords[base + 2] = z
      coords[base + 3] = id
      count++
    }

    while (cursor.value < bytes.length) {
      let groupSize = readAvroInt(bytes, cursor)
      if (groupSize === 0) break
      if (groupSize < 0) {
        groupSize = -groupSize
        declaredBlocks += readAvroInt(bytes, cursor)
      }
      groups++
      for (let chunkIndex = 0; chunkIndex < groupSize; chunkIndex++) {
        const cx = readAvroInt(bytes, cursor)
        const cy = readAvroInt(bytes, cursor)
        const cz = readAvroInt(bytes, cursor)
        if (Math.abs(cx) > 4096 || Math.abs(cy) > 4096 || Math.abs(cz) > 4096) {
          throw new Error('Schematic chunk coordinates are out of range.')
        }
        const rle = readAvroBytes(bytes, cursor)
        decodeChunkInto(rle, scratch)
        chunks++
        const baseX = cx * CHUNK
        const baseY = cy * CHUNK
        const baseZ = cz * CHUNK
        for (let lx = 0; lx < CHUNK; lx++) {
          for (let ly = 0; ly < CHUNK; ly++) {
            const row = lx * 1024 + ly * 32
            for (let lz = 0; lz < CHUNK; lz++) {
              const id = scratch[row + lz]
              if (id === AIR) continue
              const x = baseX + lx
              const y = baseY + ly
              const z = baseZ + lz
              pushBlock(x, y, z, id)
              if (x < minX) minX = x
              if (y < minY) minY = y
              if (z < minZ) minZ = z
              if (x > maxX) maxX = x
              if (y > maxY) maxY = y
              if (z > maxZ) maxZ = z
              if (count > (settings.maxBlocks || MAX_BLOCKS)) {
                throw new Error(`This schematic holds more than ${(settings.maxBlocks || MAX_BLOCKS).toLocaleString()} blocks. Split it in Bloxd first.`)
              }
            }
          }
        }
      }
    }

    if (!count) {
      return {
        name,
        position,
        declaredSize,
        voxels: new VoxelSet(0, 0, 0),
        stats: { blocks: 0, chunks, groups, declaredBlocks }
      }
    }

    const voxels = new VoxelSet(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1)
    for (let index = 0; index < count; index++) {
      const base = index * 4
      const x = coords[base] - minX
      const y = coords[base + 1] - minY
      const z = coords[base + 2] - minZ
      voxels.blocks.set(x + y * voxels.sx + z * voxels.sx * voxels.sy, coords[base + 3])
    }

    return {
      name,
      position,
      declaredSize,
      voxels,
      stats: { blocks: voxels.size, chunks, groups, declaredBlocks }
    }
  }

  /** Offsets such as `house_x128_z-64.bloxdschem` used by Bloxd map exports. */
  function parseOffsetsFromName(filename) {
    const text = String(filename || '')
    const xMatch = text.match(/_x_?(-?\d+)/i) || text.match(/-x_?(-?\d+)/i)
    const zMatch = text.match(/_z_?(-?\d+)/i) || text.match(/-z_?(-?\d+)/i)
    const yMatch = text.match(/_y_?(-?\d+)/i)
    if (!xMatch || !zMatch) return null
    return {
      x: parseInt(xMatch[1], 10),
      y: yMatch ? parseInt(yMatch[1], 10) : 0,
      z: parseInt(zMatch[1], 10)
    }
  }

  /**
   * Merge several decoded files into one voxel map.
   * Sources are {schematic, filename}. When every file has world offsets in
   * its name they are honoured; otherwise files are packed side by side along
   * X (gap 4) so they never overwrite each other.
   */
  function mergeSources(sources, options) {
    const list = (sources || []).filter(item => item && item.schematic && item.schematic.voxels.size)
    if (!list.length) return { voxels: new VoxelSet(0, 0, 0), offsets: [], mode: 'empty' }
    const gap = options && Number.isFinite(options.gap) ? options.gap : 4
    const parsedOffsets = list.map(item => parseOffsetsFromName(item.filename))
    const useNames = parsedOffsets.every(Boolean)
    const offsets = []
    let cursorX = 0
    list.forEach((item, index) => {
      const voxels = item.schematic.voxels
      if (useNames) {
        offsets.push(parsedOffsets[index])
      } else {
        offsets.push({ x: cursorX, y: 0, z: 0 })
        cursorX += voxels.sx + gap
      }
    })

    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    list.forEach((item, index) => {
      const voxels = item.schematic.voxels
      const offset = offsets[index]
      minX = Math.min(minX, offset.x)
      minY = Math.min(minY, offset.y)
      minZ = Math.min(minZ, offset.z)
      maxX = Math.max(maxX, offset.x + voxels.sx)
      maxY = Math.max(maxY, offset.y + voxels.sy)
      maxZ = Math.max(maxZ, offset.z + voxels.sz)
    })

    const merged = new VoxelSet(maxX - minX, maxY - minY, maxZ - minZ)
    list.forEach((item, index) => {
      const voxels = item.schematic.voxels
      const offset = offsets[index]
      voxels.blocks.forEach((id, key) => {
        const [x, y, z] = voxels.decode(key)
        const px = x + offset.x - minX
        const py = y + offset.y - minY
        const pz = z + offset.z - minZ
        merged.blocks.set(px + py * merged.sx + pz * merged.sx * merged.sy, id)
      })
    })

    const mode = useNames ? 'filename' : list.length === 1 ? 'single' : 'packed'
    return { voxels: merged, offsets, mode }
  }

  /* ------------------------------------------------------------------ *
   * Detection
   * ------------------------------------------------------------------ */

  /**
   * Remove flat ground platforms from the bottom layers (upstream behaviour):
   * a 2D connected layer region that fills ≥60 % of its own bounding box and
   * spans at least 3 × 3 cells is treated as a platform and deleted.
   */
  function removePlatforms(voxels, options) {
    const settings = Object.assign({ layers: 4, coverage: 0.6, minSide: 3, minCells: 9 }, options)
    if (!voxels.size) return 0
    const sx = voxels.sx
    const plane = voxels.plane
    const layerTop = Math.min(voxels.sy - 1, Math.max(0, settings.layers - 1))
    const planned = []

    for (let y = 0; y <= layerTop; y++) {
      const layer = new Map() // x + z * sx -> block key
      voxels.blocks.forEach((id, key) => {
        const z = Math.floor(key / plane)
        const rest = key - z * plane
        const layerY = Math.floor(rest / sx)
        if (layerY !== y) return
        layer.set(rest - layerY * sx + z * sx, key)
      })
      if (layer.size < settings.minCells) continue

      const visited = new Set()
      for (const start of layer.keys()) {
        if (visited.has(start)) continue
        const stack = [start]
        const component = []
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        while (stack.length) {
          const column = stack.pop()
          if (visited.has(column) || !layer.has(column)) continue
          visited.add(column)
          component.push(column)
          const x = column % sx
          const z = (column - x) / sx
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (!dx && !dz) continue
              const nx = x + dx
              const nz = z + dz
              if (nx < 0 || nz < 0 || nx >= sx || nz >= voxels.sz) continue
              stack.push(nx + nz * sx)
            }
          }
        }
        const width = maxX - minX + 1
        const depth = maxZ - minZ + 1
        if (width < settings.minSide || depth < settings.minSide) continue
        if (component.length < width * depth * settings.coverage) continue
        component.forEach(column => {
          const key = layer.get(column)
          if (key !== undefined) planned.push(key)
        })
      }
    }

    // Safety net: a flat prop (a rock, a small platform asset) made only of
    // "platform-looking" layers must never be deleted completely.
    if (!planned.length || planned.length >= voxels.size) return 0
    for (const key of planned) voxels.blocks.delete(key)
    return planned.length
  }

  const EMPTY_AABB = () => ({
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity
  })

  function growAabb(aabb, x, y, z) {
    if (x < aabb.minX) aabb.minX = x
    if (y < aabb.minY) aabb.minY = y
    if (z < aabb.minZ) aabb.minZ = z
    if (x > aabb.maxX) aabb.maxX = x
    if (y > aabb.maxY) aabb.maxY = y
    if (z > aabb.maxZ) aabb.maxZ = z
  }

  function aabbValid(aabb) {
    return Number.isFinite(aabb.minX)
  }

  function makeUnit(voxels, keys, aabb) {
    return { voxels, keys, count: keys.length, aabb, _columns: null }
  }

  /**
   * Column detection (default): Y is ignored. Every 8-connected (x, z) column
   * group becomes one unit, and all blocks of those columns belong to it, so a
   * trunk plus its canopy — or a tiny block stacked above a roof — stays
   * together. This is the rule used by the upstream splitter.
   */
  function detectUnitsByColumns(voxels) {
    if (!voxels.size) return []
    const sx = voxels.sx
    const plane = voxels.plane
    const columns = new Map()
    voxels.blocks.forEach((_id, key) => {
      const z = Math.floor(key / plane)
      const rest = key - z * plane
      const y = Math.floor(rest / sx)
      const column = rest - y * sx + z * sx
      const bucket = columns.get(column)
      if (bucket) bucket.push(key)
      else columns.set(column, [key])
    })

    const visited = new Set()
    const units = []
    for (const start of columns.keys()) {
      if (visited.has(start)) continue
      const stack = [start]
      const keys = []
      const aabb = EMPTY_AABB()
      while (stack.length) {
        const column = stack.pop()
        if (visited.has(column)) continue
        const bucket = columns.get(column)
        if (!bucket) continue
        visited.add(column)
        const x = column % sx
        const z = (column - x) / sx
        for (const key of bucket) {
          keys.push(key)
          const cz = Math.floor(key / plane)
          const rest = key - cz * plane
          const cy = Math.floor(rest / sx)
          growAabb(aabb, rest - cy * sx, cy, cz)
        }
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue
            const nx = x + dx
            const nz = z + dz
            if (nx < 0 || nz < 0 || nx >= sx || nz >= voxels.sz) continue
            const neighbor = nx + nz * sx
            if (!visited.has(neighbor) && columns.has(neighbor)) stack.push(neighbor)
          }
        }
      }
      if (keys.length) units.push(makeUnit(voxels, keys, aabb))
    }
    return units
  }

  /** Optional strict 3D mode: 26-connected block clusters (upstream `detectUnits`). */
  function detectUnitsByClusters(voxels) {
    if (!voxels.size) return []
    const sx = voxels.sx
    const sy = voxels.sy
    const plane = voxels.plane
    const visited = new Set()
    const units = []
    for (const start of voxels.blocks.keys()) {
      if (visited.has(start)) continue
      const stack = [start]
      const keys = []
      const aabb = EMPTY_AABB()
      while (stack.length) {
        const key = stack.pop()
        if (visited.has(key) || !voxels.blocks.has(key)) continue
        visited.add(key)
        keys.push(key)
        const z = Math.floor(key / plane)
        const rest = key - z * plane
        const y = Math.floor(rest / sx)
        const x = rest - y * sx
        growAabb(aabb, x, y, z)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= sx) continue
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy
            if (ny < 0 || ny >= sy) continue
            for (let dz = -1; dz <= 1; dz++) {
              if (!dx && !dy && !dz) continue
              const nz = z + dz
              if (nz < 0 || nz >= voxels.sz) continue
              const neighbor = nx + ny * sx + nz * plane
              if (!visited.has(neighbor) && voxels.blocks.has(neighbor)) stack.push(neighbor)
            }
          }
        }
      }
      if (keys.length) units.push(makeUnit(voxels, keys, aabb))
    }
    return units
  }

  function detectUnits(voxels, options) {
    const settings = Object.assign({ mode: 'columns' }, options)
    const units = settings.mode === 'clusters'
      ? detectUnitsByClusters(voxels)
      : detectUnitsByColumns(voxels)
    return sortUnits(units)
  }

  function sortUnits(units) {
    units.sort((a, b) => b.count - a.count || a.aabb.minX - b.aabb.minX || a.aabb.minZ - b.aabb.minZ)
    return units
  }

  /* ------------------------------------------------------------------ *
   * Small-unit merging
   * ------------------------------------------------------------------ */

  function columnsOf(unit) {
    if (unit._columns) return unit._columns
    const sx = unit.voxels.sx
    const plane = unit.voxels.plane
    const columns = new Set()
    for (const key of unit.keys) {
      const z = Math.floor(key / plane)
      const rest = key - z * plane
      const y = Math.floor(rest / sx)
      columns.add(rest - y * sx + z * sx)
    }
    unit._columns = columns
    return columns
  }

  function absorbUnit(target, source) {
    for (const key of source.keys) target.keys.push(key)
    target.count += source.count
    target.aabb.minX = Math.min(target.aabb.minX, source.aabb.minX)
    target.aabb.minY = Math.min(target.aabb.minY, source.aabb.minY)
    target.aabb.minZ = Math.min(target.aabb.minZ, source.aabb.minZ)
    target.aabb.maxX = Math.max(target.aabb.maxX, source.aabb.maxX)
    target.aabb.maxY = Math.max(target.aabb.maxY, source.aabb.maxY)
    target.aabb.maxZ = Math.max(target.aabb.maxZ, source.aabb.maxZ)
    if (target._columns && source._columns) {
      for (const column of source._columns) target._columns.add(column)
    } else {
      target._columns = null
    }
  }

  /**
   * Suggested merge parent for a small unit: the large unit sharing the most
   * (x, z) columns with it, otherwise the closest one by centre distance.
   */
  function findParentUnit(units, index, threshold) {
    const limit = Number.isFinite(threshold) ? threshold : SMALL_UNIT_BLOCKS
    const small = units[index]
    if (!small) return -1
    const footprint = columnsOf(small)
    let best = -1
    let bestOverlap = 0
    for (let i = 0; i < units.length; i++) {
      if (i === index || units[i].count < limit) continue
      const columns = columnsOf(units[i])
      let overlap = 0
      for (const column of footprint) if (columns.has(column)) overlap++
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = i
      }
    }
    if (best >= 0) return best
    if (small.count >= limit) return -1
    const sx = (small.aabb.minX + small.aabb.maxX) / 2
    const sy = (small.aabb.minY + small.aabb.maxY) / 2
    const sz = (small.aabb.minZ + small.aabb.maxZ) / 2
    let bestDistance = Infinity
    for (let i = 0; i < units.length; i++) {
      if (i === index || units[i].count < limit) continue
      const unit = units[i]
      const cx = (unit.aabb.minX + unit.aabb.maxX) / 2
      const cy = (unit.aabb.minY + unit.aabb.maxY) / 2
      const cz = (unit.aabb.minZ + unit.aabb.maxZ) / 2
      const distance = (sx - cx) ** 2 + (sy - cy) ** 2 + (sz - cz) ** 2
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    return best
  }

  /** Fuse every unit smaller than `threshold` into its overlapping neighbour. */
  function mergeSmallUnits(units, options) {
    // The search is quadratic; skip it on pathological maps instead of freezing.
    if (units.length > 4000) return 0
    const settings = Object.assign({ threshold: SMALL_UNIT_BLOCKS }, options)
    const threshold = Math.max(1, settings.threshold)
    let merged = 0
    let changed = true
    let guard = 0
    while (changed && guard++ < 20000) {
      changed = false
      for (let i = units.length - 1; i >= 0; i--) {
        if (units[i].count >= threshold) continue
        const parent = findParentUnit(units, i, threshold)
        if (parent >= 0) {
          absorbUnit(units[parent], units[i])
          units.splice(i, 1)
          merged++
          changed = true
          break
        }
      }
    }
    units.forEach(unit => { unit._columns = null })
    sortUnits(units)
    return merged
  }

  /** Manually merge unit `sourceIndex` into `targetIndex` (mutates the array). */
  function mergeUnits(units, sourceIndex, targetIndex) {
    if (sourceIndex === targetIndex) return units[targetIndex] || null
    const source = units[sourceIndex]
    const target = units[targetIndex]
    if (!source || !target) return null
    absorbUnit(target, source)
    units.splice(sourceIndex, 1)
    units.forEach(unit => { unit._columns = null })
    sortUnits(units)
    return target
  }

  /* ------------------------------------------------------------------ *
   * Encoding
   * ------------------------------------------------------------------ */

  function concatBytes(parts) {
    let total = 0
    parts.forEach(part => { total += part.length })
    const output = new Uint8Array(total)
    let offset = 0
    parts.forEach(part => {
      output.set(part, offset)
      offset += part.length
    })
    return output
  }

  function encodeChunkRLE(blocks) {
    const writer = new ByteWriter(512)
    for (let index = 0; index < blocks.length;) {
      const id = blocks[index]
      let run = 1
      while (index + run < blocks.length && blocks[index + run] === id) run++
      writer.uvarint(run)
      writer.uvarint(id)
      index += run
    }
    return writer.result()
  }

  const EMPTY_CHUNK_RLE = encodeChunkRLE(new Int32Array(CHUNK_VOLUME))

  function unitFromVoxels(voxels) {
    const keys = []
    const aabb = EMPTY_AABB()
    const sx = voxels.sx
    const plane = voxels.plane
    voxels.blocks.forEach((_id, key) => {
      keys.push(key)
      const z = Math.floor(key / plane)
      const rest = key - z * plane
      const y = Math.floor(rest / sx)
      growAabb(aabb, rest - y * sx, y, z)
    })
    return makeUnit(voxels, keys, keys.length ? aabb : { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 })
  }

  function unitSize(unit) {
    const aabb = unit.aabb
    return {
      x: aabb.maxX - aabb.minX + 1,
      y: aabb.maxY - aabb.minY + 1,
      z: aabb.maxZ - aabb.minZ + 1
    }
  }

  function unitChunkCount(unit) {
    const size = unitSize(unit)
    return Math.ceil(size.x / CHUNK) * Math.ceil(size.y / CHUNK) * Math.ceil(size.z / CHUNK)
  }

  /**
   * Encode a unit (or a whole VoxelSet) as a standalone .bloxdschem.
   * Chunks are written for the full padded grid with the unit's own origin,
   * matching the upstream splitter output.
   */
  function encodeUnit(unit, name) {
    if (!unit || !unit.count) throw new Error('Nothing to export: the unit has no blocks.')
    const aabb = unit.aabb
    const size = unitSize(unit)
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) throw new Error('Invalid unit bounds.')
    const chunksX = Math.ceil(size.x / CHUNK)
    const chunksY = Math.ceil(size.y / CHUNK)
    const chunksZ = Math.ceil(size.z / CHUNK)
    const totalChunks = chunksX * chunksY * chunksZ
    const voxels = unit.voxels
    const sx = voxels.sx
    const plane = voxels.plane
    const chunkMap = new Map()

    for (const key of unit.keys) {
      const z = Math.floor(key / plane)
      const rest = key - z * plane
      const y = Math.floor(rest / sx)
      const x = rest - y * sx
      const nx = x - aabb.minX
      const ny = y - aabb.minY
      const nz = z - aabb.minZ
      const cx = Math.floor(nx / CHUNK)
      const cy = Math.floor(ny / CHUNK)
      const cz = Math.floor(nz / CHUNK)
      const chunkKey = cx + ',' + cy + ',' + cz
      let chunk = chunkMap.get(chunkKey)
      if (!chunk) {
        chunk = new Int32Array(CHUNK_VOLUME)
        chunkMap.set(chunkKey, chunk)
      }
      chunk[(nx - cx * CHUNK) * 1024 + (ny - cy * CHUNK) * 32 + (nz - cz * CHUNK)] = voxels.blocks.get(key)
    }

    const writer = new ByteWriter(1024 + totalChunks * 32)
    writer.bytes(new Uint8Array([0, 0, 0, 0]))
    writer.avroString(name || 'unit')
    writer.avroInt(0)
    writer.avroInt(0)
    writer.avroInt(0)
    writer.avroInt(size.x)
    writer.avroInt(size.y)
    writer.avroInt(size.z)
    writer.avroInt(totalChunks)
    for (let cx = 0; cx < chunksX; cx++) {
      for (let cy = 0; cy < chunksY; cy++) {
        for (let cz = 0; cz < chunksZ; cz++) {
          writer.avroInt(cx)
          writer.avroInt(cy)
          writer.avroInt(cz)
          const chunk = chunkMap.get(cx + ',' + cy + ',' + cz)
          const payload = chunk ? encodeChunkRLE(chunk) : EMPTY_CHUNK_RLE
          writer.avroBytes(payload)
        }
      }
    }
    writer.avroInt(0)
    return writer.result()
  }

  function encodeVoxels(voxels, name) {
    return encodeUnit(unitFromVoxels(voxels), name)
  }

  /* ------------------------------------------------------------------ *
   * Chunk limiter — split a build into parts under Bloxd's 160-chunk cap
   * ------------------------------------------------------------------ */

  function clampChunks(value) {
    const number = Math.floor(Number(value))
    if (!Number.isFinite(number)) return MAX_CHUNKS_PER_FILE
    return Math.max(1, Math.min(MAX_CHUNKS_PER_FILE, number))
  }

  /** Chunk counts of a size on Bloxd's 32^3 chunk grid. */
  function chunkCounts(size) {
    const nx = Math.max(1, Math.ceil(Math.max(1, size.x) / CHUNK))
    const ny = Math.max(1, Math.ceil(Math.max(1, size.y) / CHUNK))
    const nz = Math.max(1, Math.ceil(Math.max(1, size.z) / CHUNK))
    return { x: nx, y: ny, z: nz, total: nx * ny * nz }
  }

  /**
   * Best XZ tile shape (in chunks) for a chunk area budget.
   * Minimises the number of parts, then prefers the largest tiles so part
   * files stay chunky instead of becoming thin slices.
   */
  function bestXZTiling(nx, nz, area) {
    let best = { x: 1, z: 1, parts: nx * nz, volume: 1 }
    const limit = Math.min(nx, Math.max(1, area))
    for (let tileX = 1; tileX <= limit; tileX++) {
      const tileZ = Math.min(nz, Math.floor(area / tileX))
      if (tileZ < 1) continue
      const parts = Math.ceil(nx / tileX) * Math.ceil(nz / tileZ)
      const volume = tileX * tileZ
      if (parts < best.parts || (parts === best.parts && volume > best.volume)) {
        best = { x: tileX, z: tileZ, parts, volume }
      }
    }
    return best
  }

  /**
   * Plan how a size is cut into parts that each stay under `maxChunks`.
   * Full height is kept whenever possible (all parts can be loaded at the same
   * Y in Bloxd); a build taller than the limit is also split vertically.
   */
  function planTiles(size, options) {
    const settings = options || {}
    const maxChunks = clampChunks(settings.maxChunks)
    const counts = chunkCounts(size)
    if (counts.total <= maxChunks) {
      return {
        maxChunks,
        nx: counts.x,
        ny: counts.y,
        nz: counts.z,
        tileX: counts.x,
        tileY: counts.y,
        tileZ: counts.z,
        cols: 1,
        rows: 1,
        layers: 1,
        parts: 1,
        single: true,
        totalChunks: counts.total,
        splitY: false
      }
    }
    const tileY = Math.min(counts.y, maxChunks)
    const area = Math.max(1, Math.floor(maxChunks / tileY))
    const best = bestXZTiling(counts.x, counts.z, area)
    const cols = Math.ceil(counts.x / best.x)
    const rows = Math.ceil(counts.z / best.z)
    const layers = Math.ceil(counts.y / tileY)
    return {
      maxChunks,
      nx: counts.x,
      ny: counts.y,
      nz: counts.z,
      tileX: best.x,
      tileY,
      tileZ: best.z,
      cols,
      rows,
      layers,
      parts: cols * rows * layers,
      single: false,
      totalChunks: counts.total,
      splitY: counts.y > maxChunks
    }
  }

  /**
   * Cut a unit into chunk-limited parts.
   * Returns `{ plan, parts: [{ unit, offset, number, chunks }] }` where the
   * offset is the part position in blocks relative to the unit origin and can
   * be written into the file name (`_x…_z…[_y…]`) for exact reassembly.
   */
  function splitUnitIntoParts(unit, options) {
    if (!unit || !unit.count) throw new Error('Nothing to split: the unit has no blocks.')
    const size = unitSize(unit)
    const plan = planTiles(size, options)
    if (plan.single) {
      return {
        plan,
        parts: [{ unit, offset: { x: 0, y: 0, z: 0 }, number: 1, chunks: unitChunkCount(unit) }]
      }
    }

    const voxels = unit.voxels
    const aabb = unit.aabb
    const stepX = plan.tileX * CHUNK
    const stepY = plan.tileY * CHUNK
    const stepZ = plan.tileZ * CHUNK
    const groups = new Map()

    for (const key of unit.keys) {
      const x = voxels.decode(key)
      const ix = Math.floor((x[0] - aabb.minX) / stepX)
      const iy = Math.floor((x[1] - aabb.minY) / stepY)
      const iz = Math.floor((x[2] - aabb.minZ) / stepZ)
      const groupKey = ix + ',' + iy + ',' + iz
      let bucket = groups.get(groupKey)
      if (!bucket) {
        bucket = { ix, iy, iz, keys: [] }
        groups.set(groupKey, bucket)
      }
      bucket.keys.push(key)
    }

    const ordered = Array.from(groups.values()).sort(
      (a, b) => a.iy - b.iy || a.ix - b.ix || a.iz - b.iz
    )

    const parts = ordered.map((group, index) => {
      const partAabb = EMPTY_AABB()
      for (const key of group.keys) {
        const point = voxels.decode(key)
        growAabb(partAabb, point[0], point[1], point[2])
      }
      const partUnit = makeUnit(voxels, group.keys, partAabb)
      return {
        unit: partUnit,
        offset: {
          x: partAabb.minX - aabb.minX,
          y: partAabb.minY - aabb.minY,
          z: partAabb.minZ - aabb.minZ
        },
        number: index + 1,
        chunks: unitChunkCount(partUnit)
      }
    })

    return { plan, parts }
  }

  function splitVoxelsIntoParts(voxels, options) {
    return splitUnitIntoParts(unitFromVoxels(voxels), options)
  }

  /** `base_part001_x0_z64.bloxdschem`, plus `_y…` when a part is stacked. */
  function partFileName(base, number, offset) {
    const clean = String(base || 'part').replace(/\.bloxdschem$/i, '')
    const padded = String(Math.max(1, Math.floor(number || 1))).padStart(3, '0')
    const x = Math.round((offset && offset.x) || 0)
    const y = Math.round((offset && offset.y) || 0)
    const z = Math.round((offset && offset.z) || 0)
    let name = `${clean}_part${padded}_x${x}_z${z}`
    if (y) name += `_y${y}`
    return name + '.bloxdschem'
  }

  /** Plain-text placement guide shipped inside part ZIP archives. */
  function buildPartsGuide(options) {
    const info = options || {}
    const parts = info.parts || []
    const maxChunks = info.maxChunks || MAX_CHUNKS_PER_FILE
    const lines = []
    lines.push('VOXELFORGE - BLOXD SCHEMATIC PARTS')
    lines.push('==================================')
    if (info.name) lines.push('Build: ' + info.name)
    if (info.blocks != null) lines.push('Blocks: ' + info.blocks)
    if (info.size) lines.push('Size: ' + info.size.x + ' x ' + info.size.y + ' x ' + info.size.z + ' blocks')
    if (info.chunks != null) lines.push('Chunks: ' + info.chunks + ' (Bloxd allows ' + maxChunks + ' per file)')
    lines.push('Files: ' + parts.length + ' - every file stays at or below ' + maxChunks + ' chunks.')
    lines.push('')
    lines.push('EN - load every part at the coordinates below, in the same world:')
    lines.push('  1. //schematic load <file>')
    lines.push('  2. move the preview so its corner sits on x / z and its base on y')
    lines.push('  3. place it, then repeat for every part.')
    lines.push('')
    parts.forEach(part => {
      const offset = part.offset || { x: 0, y: 0, z: 0 }
      const chunks = part.chunks ? '  (' + part.chunks + ' chunks)' : ''
      lines.push('  - ' + (part.file || '') + '  ->  x=' + offset.x + '  y=' + offset.y + '  z=' + offset.z + chunks)
    })
    lines.push('')
    lines.push('FR - charge chaque partie aux coordonnees ci-dessus, dans le meme monde :')
    lines.push('  1. //schematic load <fichier>')
    lines.push('  2. deplace l apercu pour que son coin soit en x / z et sa base en y')
    lines.push('  3. pose-la, puis repete pour chaque partie.')
    lines.push('')
    lines.push('Loading every part at the same Y rebuilds the original build.')
    lines.push("Charger toutes les parties au meme Y reconstruit le build d'origine.")
    return lines.join('\n') + '\n'
  }

  /**
   * Split a plain `x,y,z` -> blockId map (the editor's voxel world format)
   * into chunk-limited parts, without building an intermediate VoxelSet first.
   * Returns `{ voxels, plan, parts }` where every part is `{ unit, offset, number, chunks }`.
   */
  function splitVoxelMap(voxelMap, options) {
    const voxels = new VoxelSet(0, 0, 0).adoptStringMap(voxelMap)
    const result = splitVoxelsIntoParts(voxels, options)
    return { voxels, plan: result.plan, parts: result.parts }
  }

  /** Encode every part as a real .bloxdschem file, ready for a ZIP. */
  function encodeVoxelParts(parts, baseName) {
    const base = String(baseName || 'build').replace(/\.bloxdschem$/i, '')
    return (parts || []).map(part => {
      const file = partFileName(base, part.number, part.offset)
      return {
        name: file,
        data: encodeUnit(part.unit, file.replace(/\.bloxdschem$/i, '')),
        offset: part.offset,
        number: part.number,
        chunks: part.chunks
      }
    })
  }

  /**
   * Encode a `x,y,z` -> blockId map for Bloxd, splitting it automatically when
   * it is above the chunk limit. Never refuses a build.
   *
   * Returns either
   *   { mode: 'single', bytes, chunks, blockCount, size }
   * or
   *   { mode: 'split', files, zip, parts, plan, blockCount, largestPart, ... }
   * The split result also embeds `manifest.json` and `GUIDE_IMPORTATION.txt`.
   */
  function encodeVoxelMapForBloxd(voxelMap, options) {
    const settings = options || {}
    const name = String(settings.name || 'Bloxd Build')
    const maxChunks = clampChunks(settings.maxChunks)
    const allowSplit = settings.allowSplit !== false
    if (!voxelMap || !voxelMap.size) throw new Error('There are no visible blocks to export.')

    const voxels = new VoxelSet(0, 0, 0).adoptStringMap(voxelMap)
    const unit = unitFromVoxels(voxels)
    const chunks = unitChunkCount(unit)
    if (chunks <= maxChunks || !allowSplit) {
      return {
        mode: 'single',
        bytes: encodeUnit(unit, name),
        chunks,
        blockCount: voxels.size,
        size: unitSize(unit),
        maxChunks,
        overLimit: chunks > maxChunks
      }
    }

    const { plan, parts } = splitUnitIntoParts(unit, { maxChunks })
    const base = String(name)
      .replace(/\.bloxdschem$/i, '')
      .replace(/[^\w\-.]+/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '') || 'build'
    const encoded = parts.map(part => ({
      name: partFileName(base, part.number, part.offset),
      data: encodeUnit(part.unit, (base + '_part' + String(part.number).padStart(3, '0'))),
      offset: part.offset,
      number: part.number,
      chunks: part.chunks,
      blocks: part.unit.count
    }))
    const manifest = {
      schematics: encoded.map(part => ({
        file: part.name,
        name: part.name.replace(/\.bloxdschem$/i, ''),
        type: 'auto',
        biome: 'classic',
        x: part.offset.x,
        y: part.offset.y,
        z: part.offset.z
      }))
    }
    const files = encoded.map(part => ({ name: part.name, data: part.data }))
    files.push({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) })
    files.push({
      name: 'GUIDE_IMPORTATION.txt',
      data: new TextEncoder().encode(buildPartsGuide({
        name: base,
        blocks: voxels.size,
        size: unitSize(unit),
        chunks: plan.totalChunks,
        maxChunks,
        parts: encoded
      }))
    })
    return {
      mode: 'split',
      files,
      zip: createZip(files),
      parts: encoded.length,
      plan,
      blockCount: voxels.size,
      size: unitSize(unit),
      largestPart: encoded.reduce((max, part) => Math.max(max, part.chunks), 0),
      splitOnY: plan.splitY,
      maxChunks,
      overLimit: true
    }
  }

  /* ------------------------------------------------------------------ *
   * ZIP writer (store method, UTF-8 file names) — no external dependency
   * ------------------------------------------------------------------ */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    return table
  })()

  function crc32(bytes) {
    let crc = 0xffffffff
    for (let index = 0; index < bytes.length; index++) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  function dosDateTime(date) {
    const source = date || new Date()
    const year = Math.max(1980, source.getFullYear())
    return {
      time: (source.getHours() << 11) | (source.getMinutes() << 5) | Math.floor(source.getSeconds() / 2),
      date: (((year - 1980) & 0x7f) << 9) | ((source.getMonth() + 1) << 5) | source.getDate()
    }
  }

  /**
   * Build a ZIP archive from `[{ name, data: Uint8Array }]`.
   * Files are stored (no deflate) because .bloxdschem payloads are already
   * run-length encoded; every unzip tool and Windows Explorer can open it.
   */
  function createZip(files) {
    const entries = files || []
    if (entries.length > 60000) throw new Error('Too many files for one ZIP archive.')
    const stamp = dosDateTime(new Date())
    const writer = new ByteWriter(1 << 16)
    const central = []
    let offset = 0

    entries.forEach(entry => {
      const nameBytes = new TextEncoder().encode(entry.name)
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data)
      const crc = crc32(data)
      const localOffset = offset
      writer.u32(0x04034b50)
      writer.u16(20)
      writer.u16(0x0800)
      writer.u16(0)
      writer.u16(stamp.time)
      writer.u16(stamp.date)
      writer.u32(crc)
      writer.u32(data.length)
      writer.u32(data.length)
      writer.u16(nameBytes.length)
      writer.u16(0)
      writer.bytes(nameBytes)
      writer.bytes(data)
      offset = writer.length
      central.push({ nameBytes, crc, size: data.length, localOffset })
    })

    const centralStart = writer.length
    central.forEach(item => {
      writer.u32(0x02014b50)
      writer.u16(20)
      writer.u16(20)
      writer.u16(0x0800)
      writer.u16(0)
      writer.u16(stamp.time)
      writer.u16(stamp.date)
      writer.u32(item.crc)
      writer.u32(item.size)
      writer.u32(item.size)
      writer.u16(item.nameBytes.length)
      writer.u16(0)
      writer.u16(0)
      writer.u16(0)
      writer.u16(0)
      writer.u32(0)
      writer.u32(item.localOffset)
      writer.bytes(item.nameBytes)
    })
    const centralSize = writer.length - centralStart
    writer.u32(0x06054b50)
    writer.u16(0)
    writer.u16(0)
    writer.u16(central.length)
    writer.u16(central.length)
    writer.u32(centralSize)
    writer.u32(centralStart)
    writer.u16(0)
    return writer.result()
  }

  /* ------------------------------------------------------------------ *
   * Small helpers shared with the UI
   * ------------------------------------------------------------------ */

  function unitColor(index) {
    let hue = (index * GOLDEN_ANGLE) % 360
    if (hue < 0) hue += 360
    const saturation = 0.62
    const value = 0.95
    const chroma = value * saturation
    const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    const match = value - chroma
    let r = 0, g = 0, b = 0
    if (hue < 60) { r = chroma; g = secondary } else if (hue < 120) { r = secondary; g = chroma } else if (hue < 180) { g = chroma; b = secondary } else if (hue < 240) { g = secondary; b = chroma } else if (hue < 300) { r = secondary; b = chroma } else { r = chroma; b = secondary }
    const toHex = number => ('0' + Math.round((number + match) * 255).toString(16)).slice(-2)
    return {
      r: r + match,
      g: g + match,
      b: b + match,
      hex: '#' + toHex(r) + toHex(g) + toHex(b)
    }
  }

  function describeUnit(unit) {
    const size = unitSize(unit)
    return {
      blocks: unit.count,
      size,
      chunks: unitChunkCount(unit)
    }
  }

  const api = {
    CHUNK,
    CHUNK_VOLUME,
    MAX_BLOCKS,
    SMALL_UNIT_BLOCKS,
    MAX_CHUNKS_PER_FILE,
    VoxelSet,
    ByteWriter,
    parseSchematic,
    parseOffsetsFromName,
    mergeSources,
    removePlatforms,
    detectUnits,
    detectUnitsByColumns,
    detectUnitsByClusters,
    sortUnits,
    findParentUnit,
    mergeSmallUnits,
    mergeUnits,
    unitFromVoxels,
    unitSize,
    unitChunkCount,
    encodeUnit,
    encodeVoxels,
    encodeChunkRLE,
    chunkCounts,
    planTiles,
    bestXZTiling,
    splitUnitIntoParts,
    splitVoxelsIntoParts,
    partFileName,
    buildPartsGuide,
    splitVoxelMap,
    encodeVoxelParts,
    encodeVoxelMapForBloxd,
    createZip,
    crc32,
    unitColor,
    describeUnit
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  global.BloxdSchemSplitter = api
})(typeof window !== 'undefined' ? window : globalThis)
