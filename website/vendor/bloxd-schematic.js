/*
 * Bloxd schematic encoder + mesh voxelizer.
 * Format implementation independently adapted from the Apache-2.0 project:
 * https://github.com/Souls-equal/Bloxd_Map_Editor
 * Uses Bloxd's 4-byte header, Avro zig-zag fields, 32^3 chunks and RLE/uvarint blocks.
 */
(function (global) {
  'use strict'

  const CHUNK_SIZE = 32
  const CHUNK_VOLUME = 32768
  const MAX_CHUNKS = 160

  const BLOCK_PALETTE = [
    { id: 28, name: 'Stone', color: 0x808080 },
    { id: 31, name: 'Smooth Stone', color: 0x9a9a9a },
    { id: 32, name: 'Diorite', color: 0xdcdcdc },
    { id: 34, name: 'Andesite', color: 0x86847f },
    { id: 36, name: 'Granite', color: 0x9b7c71 },
    { id: 38, name: 'Sandstone', color: 0xddc98a },
    { id: 128, name: 'Bricks', color: 0x934b42 },
    { id: 129, name: 'Stone Bricks', color: 0x7f7f79 },
    { id: 132, name: 'Block of Quartz', color: 0xf4efe4 },
    { id: 140, name: 'Obsidian', color: 0x140d23 },
    { id: 147, name: 'Bedrock', color: 0x2f2f34 },
    { id: 15, name: 'Maple Wood Planks', color: 0xc19a6b },
    { id: 19, name: 'Pine Wood Planks', color: 0x8d7350 },
    { id: 20, name: 'Cedar Wood Planks', color: 0x8a6f4d },
    { id: 106, name: 'Glass', color: 0xcfe8f5 },
    { id: 47, name: 'Block of Iron', color: 0xd4d4d4 },
    { id: 48, name: 'Block of Gold', color: 0xf3d04a },
    { id: 50, name: 'Block of Emerald', color: 0x3dd06b },
    { id: 172, name: 'Block of Diamond', color: 0x63d8e8 },
    { id: 51, name: 'White Wool', color: 0xf2f2f2 },
    { id: 52, name: 'Orange Wool', color: 0xea7e35 },
    { id: 53, name: 'Magenta Wool', color: 0xc74ebd },
    { id: 54, name: 'Light Blue Wool', color: 0x6387d2 },
    { id: 55, name: 'Yellow Wool', color: 0xb8a93a },
    { id: 56, name: 'Lime Wool', color: 0x72b828 },
    { id: 57, name: 'Pink Wool', color: 0xe88da2 },
    { id: 58, name: 'Gray Wool', color: 0x6a6a6a },
    { id: 59, name: 'Light Gray Wool', color: 0xa0a0a0 },
    { id: 60, name: 'Cyan Wool', color: 0x6099a8 },
    { id: 61, name: 'Purple Wool', color: 0x804dba },
    { id: 62, name: 'Blue Wool', color: 0x3c54ad },
    { id: 63, name: 'Brown Wool', color: 0x7b5536 },
    { id: 64, name: 'Green Wool', color: 0x4d8a33 },
    { id: 65, name: 'Red Wool', color: 0xa03333 },
    { id: 66, name: 'Black Wool', color: 0x1b1b20 },
    { id: 97, name: 'White Concrete', color: 0xd5d5d5 },
    { id: 93, name: 'Orange Concrete', color: 0xce6f2e },
    { id: 92, name: 'Magenta Concrete', color: 0xaf45a6 },
    { id: 90, name: 'Light Blue Concrete', color: 0x5777b9 },
    { id: 99, name: 'Yellow Concrete', color: 0xa29533 },
    { id: 91, name: 'Lime Concrete', color: 0x65a223 },
    { id: 94, name: 'Pink Concrete', color: 0xcc7c8e },
    { id: 84, name: 'Gray Concrete', color: 0x5d5d5d },
    { id: 85, name: 'Light Gray Concrete', color: 0x8d8d8d },
    { id: 89, name: 'Cyan Concrete', color: 0x548795 },
    { id: 95, name: 'Purple Concrete', color: 0x7144a4 },
    { id: 87, name: 'Blue Concrete', color: 0x354a98 },
    { id: 88, name: 'Brown Concrete', color: 0x6c4b2f },
    { id: 98, name: 'Green Concrete', color: 0x447a2d },
    { id: 96, name: 'Red Concrete', color: 0x8d2d2d },
    { id: 86, name: 'Black Concrete', color: 0x18181c }
  ]

  function readUvarint(bytes, offset) {
    let value = 0, shift = 0
    for (let index = 0; index < 10; index++) {
      if (offset.value >= bytes.length) throw new Error('Unexpected end of schematic varint.')
      const byte = bytes[offset.value++]
      value += (byte & 0x7f) * Math.pow(2, shift)
      if (byte < 0x80) return value
      shift += 7
    }
    throw new Error('Schematic varint is too long.')
  }
  function readAvroInt(bytes, offset) { const value=readUvarint(bytes,offset);return value%2===0?value/2:-(value+1)/2 }
  function readAvroBytes(bytes, offset) { const length=readAvroInt(bytes,offset);if(length<0||offset.value+length>bytes.length)throw new Error('Invalid schematic byte field.');const value=bytes.slice(offset.value,offset.value+length);offset.value+=length;return value }
  function readAvroString(bytes, offset) { return new TextDecoder().decode(readAvroBytes(bytes,offset)) }
  function decodeChunkRLE(bytes) {
    const blocks=new Int32Array(CHUNK_VOLUME),offset={value:0};let index=0
    while(index<CHUNK_VOLUME){const count=readUvarint(bytes,offset),id=readUvarint(bytes,offset);if(count<=0)throw new Error('Invalid zero-length schematic run.');blocks.fill(id,index,Math.min(CHUNK_VOLUME,index+count));index+=count}
    return blocks
  }
  function decodeSchematic(input) {
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),offset={value:0}
    if(bytes.length<4)throw new Error('Schematic is too short.')
    for(let i=0;i<4;i++)if(bytes[offset.value++]!==0)throw new Error('Unsupported schematic header.')
    const name=readAvroString(bytes,offset),position={x:readAvroInt(bytes,offset),y:readAvroInt(bytes,offset),z:readAvroInt(bytes,offset)},declaredSize={x:readAvroInt(bytes,offset),y:readAvroInt(bytes,offset),z:readAvroInt(bytes,offset)},raw=[]
    while(true){let count=readAvroInt(bytes,offset);if(count===0)break;if(count<0){count=-count;readAvroInt(bytes,offset)}for(let i=0;i<count;i++){const cx=readAvroInt(bytes,offset),cy=readAvroInt(bytes,offset),cz=readAvroInt(bytes,offset),chunk=decodeChunkRLE(readAvroBytes(bytes,offset));for(let lx=0;lx<CHUNK_SIZE;lx++)for(let ly=0;ly<CHUNK_SIZE;ly++)for(let lz=0;lz<CHUNK_SIZE;lz++){const id=chunk[lx*1024+ly*32+lz];if(id)raw.push([position.x+cx*CHUNK_SIZE+lx,position.y+cy*CHUNK_SIZE+ly,position.z+cz*CHUNK_SIZE+lz,id])}}}
    if(!raw.length)return{name,position,declaredSize,size:{x:0,y:0,z:0},blockCount:0,voxels:new Map()}
    const min=[0,1,2].map(axis=>Math.min(...raw.map(block=>block[axis]))),max=[0,1,2].map(axis=>Math.max(...raw.map(block=>block[axis]))),voxels=new Map();raw.forEach(block=>voxels.set(`${block[0]-min[0]},${block[1]-min[1]},${block[2]-min[2]}`,block[3]))
    return{name,position,declaredSize,size:{x:max[0]-min[0]+1,y:max[1]-min[1]+1,z:max[2]-min[2]+1},blockCount:voxels.size,voxels}
  }

  function writeUvarint(value) {
    let n = Math.max(0, Math.floor(value))
    const bytes = []
    while (n >= 0x80) {
      bytes.push((n & 0x7f) | 0x80)
      n = Math.floor(n / 128)
    }
    bytes.push(n & 0x7f)
    return new Uint8Array(bytes)
  }

  function writeAvroInt(value) {
    const n = Math.floor(value)
    return writeUvarint(n < 0 ? (-n * 2 - 1) : n * 2)
  }

  function concatBytes(parts) {
    const size = parts.reduce((total, part) => total + part.length, 0)
    const output = new Uint8Array(size)
    let offset = 0
    parts.forEach((part) => { output.set(part, offset); offset += part.length })
    return output
  }

  function writeAvroString(value) {
    const bytes = new TextEncoder().encode(value)
    return concatBytes([writeAvroInt(bytes.length), bytes])
  }

  function writeAvroBytes(value) {
    return concatBytes([writeAvroInt(value.length), value])
  }

  function encodeChunkRLE(blocks) {
    const parts = []
    for (let index = 0; index < blocks.length;) {
      const id = blocks[index]
      let count = 1
      while (index + count < blocks.length && blocks[index + count] === id) count++
      parts.push(writeUvarint(count), writeUvarint(id))
      index += count
    }
    return concatBytes(parts)
  }

  function nearestBlockId(hexColor) {
    const r = (hexColor >> 16) & 255
    const g = (hexColor >> 8) & 255
    const b = hexColor & 255
    let nearest = BLOCK_PALETTE[0]
    let nearestDistance = Infinity
    BLOCK_PALETTE.forEach((block) => {
      const br = (block.color >> 16) & 255
      const bg = (block.color >> 8) & 255
      const bb = block.color & 255
      // Slightly perceptual RGB distance.
      const distance = 2 * (r - br) ** 2 + 4 * (g - bg) ** 2 + 3 * (b - bb) ** 2
      if (distance < nearestDistance) { nearestDistance = distance; nearest = block }
    })
    return nearest.id
  }

  function encodeSchematic(voxels, name) {
    if (!voxels || !voxels.size) throw new Error('The voxel result is empty.')
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    voxels.forEach((id, key) => {
      const [x, y, z] = key.split(',').map(Number)
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z)
    })

    const actualSize = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 }
    const chunkCount = {
      x: Math.ceil(actualSize.x / CHUNK_SIZE),
      y: Math.ceil(actualSize.y / CHUNK_SIZE),
      z: Math.ceil(actualSize.z / CHUNK_SIZE)
    }
    const totalChunks = chunkCount.x * chunkCount.y * chunkCount.z
    if (totalChunks > MAX_CHUNKS) {
      throw new Error(
        `This model needs ${totalChunks} chunks and Bloxd allows ${MAX_CHUNKS} per schematic. ` +
        `Keep “Split automatically above the limit” ticked in the BLOXD export dialog to export it as several parts, ` +
        `or lower the resolution.`
      )
    }

    const chunks = new Map()
    voxels.forEach((id, key) => {
      const [x0, y0, z0] = key.split(',').map(Number)
      const x = x0 - minX, y = y0 - minY, z = z0 - minZ
      const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE)
      const chunkKey = `${cx},${cy},${cz}`
      if (!chunks.has(chunkKey)) chunks.set(chunkKey, new Int32Array(CHUNK_VOLUME))
      chunks.get(chunkKey)[(x % 32) * 1024 + (y % 32) * 32 + (z % 32)] = id
    })

    const paddedSize = { x: chunkCount.x * 32, y: chunkCount.y * 32, z: chunkCount.z * 32 }
    const emptyRLE = encodeChunkRLE(new Int32Array(CHUNK_VOLUME))
    const parts = [new Uint8Array([0, 0, 0, 0]), writeAvroString(name || '3D Model')]
    parts.push(writeAvroInt(0), writeAvroInt(0), writeAvroInt(0))
    parts.push(writeAvroInt(paddedSize.x), writeAvroInt(paddedSize.y), writeAvroInt(paddedSize.z))
    parts.push(writeAvroInt(totalChunks))
    for (let cx = 0; cx < chunkCount.x; cx++) {
      for (let cy = 0; cy < chunkCount.y; cy++) {
        for (let cz = 0; cz < chunkCount.z; cz++) {
          const key = `${cx},${cy},${cz}`
          parts.push(writeAvroInt(cx), writeAvroInt(cy), writeAvroInt(cz))
          parts.push(writeAvroBytes(chunks.has(key) ? encodeChunkRLE(chunks.get(key)) : emptyRLE))
        }
      }
    }
    parts.push(writeAvroInt(0))
    return { bytes: concatBytes(parts), actualSize, paddedSize, totalChunks, blockCount: voxels.size }
  }

  async function voxelizeObject(root, options, onProgress) {
    const THREE = options.THREE || global.THREE
    if (!THREE) throw new Error('Three.js is required for voxelization.')
    const scale = Math.max(0.1, Math.min(12, Number(options.blocksPerUnit) || 2))
    const singleBlockId = Number(options.blockId) || 28
    const colorMatch = options.materialMode === 'colors'
    const voxels = new Map()
    const meshEntries = []

    root.updateMatrixWorld(true)
    root.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible || !mesh.geometry || !mesh.geometry.getAttribute('position')) return
      let ancestor = mesh.parent
      while (ancestor && ancestor !== root) {
        if (!ancestor.visible) return
        ancestor = ancestor.parent
      }
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
      meshEntries.push({ mesh, geometry, temporary: geometry !== mesh.geometry })
    })
    if (!meshEntries.length) throw new Error('No visible triangle meshes were found.')

    let triangleTotal = 0
    meshEntries.forEach(entry => { triangleTotal += Math.floor(entry.geometry.getAttribute('position').count / 3) })
    let processed = 0
    let candidateChecks = 0
    const maxCandidateChecks = Number(options.maxCandidateChecks) || 25000000
    const closest = new THREE.Vector3()
    const center = new THREE.Vector3()

    for (const entry of meshEntries) {
      const position = entry.geometry.getAttribute('position')
      const materials = Array.isArray(entry.mesh.material) ? entry.mesh.material : [entry.mesh.material]
      const groups = entry.geometry.groups || []
      const materialAt = offset => {
        const group = groups.find(item => offset >= item.start && offset < item.start + item.count)
        return materials[group ? group.materialIndex : 0] || materials.find(Boolean)
      }

      for (let index = 0; index < position.count; index += 3) {
        const triangleIndex = Math.floor(index / 3)
        const material = materialAt(index)
        let match = null
        if (colorMatch && material) {
          const colorInfo = global.BloxdColorMatcher
            ? global.BloxdColorMatcher.materialColor(material, entry.geometry, triangleIndex, { textures: options.textureColors !== false })
            : { hex: material.color ? material.color.getHex() : 0x808080, alpha: material.opacity == null ? 1 : material.opacity }
          match = global.BloxdColorMatcher
            ? global.BloxdColorMatcher.nearest(colorInfo.hex, { family: options.paletteFamily || 'safe', alpha: colorInfo.alpha })
            : { best: { id: nearestBlockId(colorInfo.hex), distance: 0 }, second: { id: nearestBlockId(colorInfo.hex), distance: 1 } }
        }
        const a = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(entry.mesh.matrixWorld).multiplyScalar(scale)
        const b = new THREE.Vector3().fromBufferAttribute(position, index + 1).applyMatrix4(entry.mesh.matrixWorld).multiplyScalar(scale)
        const c = new THREE.Vector3().fromBufferAttribute(position, index + 2).applyMatrix4(entry.mesh.matrixWorld).multiplyScalar(scale)
        const triangle = new THREE.Triangle(a, b, c)
        const minX = Math.floor(Math.min(a.x, b.x, c.x) - 0.75), maxX = Math.floor(Math.max(a.x, b.x, c.x) + 0.75)
        const minY = Math.floor(Math.min(a.y, b.y, c.y) - 0.75), maxY = Math.floor(Math.max(a.y, b.y, c.y) + 0.75)
        const minZ = Math.floor(Math.min(a.z, b.z, c.z) - 0.75), maxZ = Math.floor(Math.max(a.z, b.z, c.z) + 0.75)
        const candidates = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1)
        candidateChecks += candidates
        if (candidateChecks > maxCandidateChecks) throw new Error('Voxelization is too detailed for this model. Lower Blocks per unit or simplify the mesh.')

        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
              center.set(x + 0.5, y + 0.5, z + 0.5)
              triangle.closestPointToPoint(center, closest)
              if (closest.distanceToSquared(center) <= 0.76) {
                let blockId = singleBlockId
                if (match) {
                  blockId = match.best.id
                  if (options.dither && match.second && match.second.id !== match.best.id) {
                    const chance = match.best.distance / Math.max(0.0001, match.best.distance + match.second.distance)
                    const hash = Math.abs((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % 1000 / 1000
                    if (hash < chance) blockId = match.second.id
                  }
                }
                voxels.set(`${x},${y},${z}`, blockId)
              }
            }
          }
        }
        processed++
        if (voxels.size > 2000000) throw new Error('The result exceeds the safe 2,000,000-block conversion limit. Lower the resolution.')
        if (processed % 150 === 0) {
          if (onProgress) onProgress(processed / triangleTotal)
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      if (entry.temporary) entry.geometry.dispose()
    }

    if (options.fillMode === 'solid') {
      const columns = new Map()
      voxels.forEach((id, key) => {
        const [x, y, z] = key.split(',').map(Number)
        const columnKey = `${x},${z}`
        const current = columns.get(columnKey)
        if (!current) columns.set(columnKey, { min: y, max: y, id })
        else { current.min = Math.min(current.min, y); current.max = Math.max(current.max, y) }
      })
      columns.forEach((column, key) => {
        const [x, z] = key.split(',').map(Number)
        for (let y = column.min; y <= column.max; y++) {
          const voxelKey = `${x},${y},${z}`
          if (!voxels.has(voxelKey)) voxels.set(voxelKey, colorMatch ? column.id : singleBlockId)
          if (voxels.size > 2000000) throw new Error('Solid fill exceeds the safe 2,000,000-block conversion limit. Use shell mode or lower the resolution.')
        }
      })
    }

    if (onProgress) onProgress(1)
    return voxels
  }

  const api = { CHUNK_SIZE, CHUNK_VOLUME, MAX_CHUNKS, BLOCK_PALETTE, nearestBlockId, encodeSchematic, decodeSchematic, voxelizeObject }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  global.BloxdSchematic = api
})(typeof window !== 'undefined' ? window : globalThis)
