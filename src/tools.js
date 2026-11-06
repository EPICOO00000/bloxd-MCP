'use strict'

const catalog = require('./catalog')
const { writeExportFiles } = require('./world')
const path = require('path')
const fs = require('fs')

const EXPORTS = path.join(__dirname, '..', 'exports')

function vec3(v, name) {
  if (!Array.isArray(v) || v.length < 3) throw new Error(`${name} must be [x, y, z].`)
  return v.map(n => Number(n) || 0)
}

function blockId(value, fallback) {
  if (value == null || value === '') {
    if (fallback == null) throw new Error('block is required.')
    return catalog.resolveBlock(fallback).id
  }
  return catalog.resolveBlock(value).id
}

function ok(data) {
  return { ok: true, ...data }
}

const TOOLS = [
  {
    name: 'new_project',
    description: 'Start a fresh schematic world and/or mesh. Call this before building something new.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name used in exported filenames.' },
        what: { type: 'string', enum: ['both', 'world', 'mesh'], description: 'What to reset. Default both.' }
      }
    }
  },
  {
    name: 'get_stats',
    description: 'World + mesh stats: block count, bounds, Bloxd chunk count (160 max per file), selection, mesh parts.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'lookup_block',
    description: 'Search the official 2,090 Bloxd block names/IDs. Pass a name fragment, numeric id, or #RRGGBB color.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'nearest_block',
    description: 'Find the closest official Bloxd block to an RGB color.',
    inputSchema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: '#RRGGBB' },
        family: { type: 'string', enum: ['safe', 'natural', 'concrete', 'wool', 'glass', 'wood', 'colored'] }
      },
      required: ['color']
    }
  },
  {
    name: 'set_block',
    description: 'Place or paint a single block. id 0 / Air removes it.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        block: { type: 'string', description: 'Name or numeric id. Use "Air" to delete.' }
      },
      required: ['x', 'y', 'z', 'block']
    }
  },
  {
    name: 'set_blocks',
    description: 'Place many blocks at once. Each entry is [x, y, z, blockNameOrId]. Faster than set_block for details.',
    inputSchema: {
      type: 'object',
      properties: {
        blocks: { type: 'array', items: { type: 'array' } }
      },
      required: ['blocks']
    }
  },
  {
    name: 'get_block',
    description: 'Read the block at x,y,z.',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'fill_box',
    description: 'Fill an axis-aligned box from corner a to corner b. hollow=true builds only the shell (walls/floor/ceiling).',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'number' }, description: '[x,y,z] first corner' },
        b: { type: 'array', items: { type: 'number' }, description: '[x,y,z] opposite corner' },
        block: { type: 'string' },
        hollow: { type: 'boolean' }
      },
      required: ['a', 'b', 'block']
    }
  },
  {
    name: 'fill_sphere',
    description: 'Solid or hollow sphere centered at x,y,z.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        radius: { type: 'number' },
        block: { type: 'string' },
        hollow: { type: 'boolean' }
      },
      required: ['x', 'y', 'z', 'radius', 'block']
    }
  },
  {
    name: 'fill_ellipsoid',
    description: 'Ellipsoid (stretched sphere) with independent radii.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        rx: { type: 'number' }, ry: { type: 'number' }, rz: { type: 'number' },
        block: { type: 'string' },
        hollow: { type: 'boolean' }
      },
      required: ['x', 'y', 'z', 'rx', 'ry', 'rz', 'block']
    }
  },
  {
    name: 'fill_cylinder',
    description: 'Cylinder. axis is y (upright, default), x, or z.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        radius: { type: 'number' },
        height: { type: 'number' },
        block: { type: 'string' },
        hollow: { type: 'boolean' },
        axis: { type: 'string', enum: ['x', 'y', 'z'] }
      },
      required: ['x', 'y', 'z', 'radius', 'height', 'block']
    }
  },
  {
    name: 'draw_line',
    description: 'Voxel line from a to b. Optional radius makes a thick tube.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'number' } },
        b: { type: 'array', items: { type: 'number' } },
        block: { type: 'string' },
        radius: { type: 'number' }
      },
      required: ['a', 'b', 'block']
    }
  },
  {
    name: 'draw_ring',
    description: 'Horizontal (default) or vertical ring / torus slice.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        radius: { type: 'number' },
        block: { type: 'string' },
        thickness: { type: 'number' },
        axis: { type: 'string', enum: ['x', 'y', 'z'] }
      },
      required: ['x', 'y', 'z', 'radius', 'block']
    }
  },
  {
    name: 'draw_cone',
    description: 'Point-up cone sitting on y.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        radius: { type: 'number' },
        height: { type: 'number' },
        block: { type: 'string' }
      },
      required: ['x', 'y', 'z', 'radius', 'height', 'block']
    }
  },
  {
    name: 'draw_pyramid',
    description: 'Stepped pyramid. size is the base half-width in blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        size: { type: 'number' },
        height: { type: 'number' },
        block: { type: 'string' },
        hollow: { type: 'boolean' }
      },
      required: ['x', 'y', 'z', 'size', 'block']
    }
  },
  {
    name: 'flood_fill',
    description: 'Recolor a connected blob of the same block id, 6-neighbour.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        block: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['x', 'y', 'z', 'block']
    }
  },
  {
    name: 'replace_blocks',
    description: 'Replace every from-block with to-block, optionally inside a box region.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        a: { type: 'array', items: { type: 'number' } },
        b: { type: 'array', items: { type: 'number' } }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'remove_region',
    description: 'Delete every block inside the box a→b.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'number' } },
        b: { type: 'array', items: { type: 'number' } }
      },
      required: ['a', 'b']
    }
  },
  {
    name: 'select_box',
    description: 'Select every occupied block inside a→b. Later rotate/mirror/hollow/dilate/erode/extrude use this selection.',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'array', items: { type: 'number' } },
        b: { type: 'array', items: { type: 'number' } },
        additive: { type: 'boolean' }
      },
      required: ['a', 'b']
    }
  },
  {
    name: 'select_connected',
    description: 'Select the connected same-type blob at x,y,z.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        additive: { type: 'boolean' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'copy_selection',
    description: 'Copy the current selection to the clipboard (keeps original).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cut_selection',
    description: 'Cut the current selection to the clipboard.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'paste',
    description: 'Paste the clipboard with its lowest corner at x,y,z.',
    inputSchema: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'delete_selection',
    description: 'Delete selected blocks without copying.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'move_selection',
    description: 'Nudge the selection by dx,dy,dz blocks.',
    inputSchema: {
      type: 'object',
      properties: { dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' } }
    }
  },
  {
    name: 'rotate_selection',
    description: 'Rotate the selection 90° around x, y (default) or z.',
    inputSchema: {
      type: 'object',
      properties: {
        axis: { type: 'string', enum: ['x', 'y', 'z'] },
        clockwise: { type: 'boolean' }
      }
    }
  },
  {
    name: 'mirror_selection',
    description: 'Mirror the selection across x, y or z.',
    inputSchema: {
      type: 'object',
      properties: { axis: { type: 'string', enum: ['x', 'y', 'z'] } }
    }
  },
  {
    name: 'hollow_selection',
    description: 'Delete interior blocks of the selection, keeping a 1-block shell.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'dilate_selection',
    description: 'Grow the selection by 1 block (von Neumann).',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'erode_selection',
    description: 'Shrink the selection by 1 block.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'smooth_selection',
    description: 'Majority-smooth block ids on the selection.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'extrude_selection',
    description: 'Extrude the selection along dx,dy,dz (default +Y by 1).',
    inputSchema: {
      type: 'object',
      properties: { dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' } }
    }
  },
  {
    name: 'undo',
    description: 'Undo the last world edit.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'redo',
    description: 'Redo the last undone world edit.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'terrain_brush',
    description: 'VoxelForge terrain/biome brush. tool: raise, lower, flatten, smooth, erode, terrace, river, road, cliff, beach, biome, vegetation, snow.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        tool: { type: 'string' },
        radius: { type: 'number' },
        strength: { type: 'number' },
        biome: { type: 'string', enum: ['tropical', 'temperate', 'arid', 'alpine', 'volcanic', 'alien'] },
        falloff: { type: 'string', enum: ['smooth', 'linear', 'hard'] },
        depth: { type: 'number' },
        seed: { type: 'string' },
        density: { type: 'number' },
        water: { type: 'boolean' }
      },
      required: ['x', 'y', 'z', 'tool']
    }
  },
  {
    name: 'generate_structure',
    description: 'Native Bloxd procedural generator. type: terrain, island, canyon, tunnel, city, tower, castle, coral, crystals, rocks, maze, pipes, fractal, station.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        size: { type: 'number', description: 'Generator size in model units (default 12).' },
        height: { type: 'number' },
        seed: { type: 'string' },
        blocksPerUnit: { type: 'number' },
        extra: { type: 'object', description: 'Any extra generator params (wallHeight, cellSize, ...).' }
      },
      required: ['type']
    }
  },
  {
    name: 'apply_texture',
    description: 'Paint a weighted block palette with noise (fractal Perlin, checker, stripes, ...).',
    inputSchema: {
      type: 'object',
      properties: {
        palette: { type: 'array', description: '[{id or name, weight}] or block names.' },
        mode: { type: 'string', enum: ['fbm', 'perlin', 'ridged', 'value', 'cellular', 'random', 'checker', 'stripes', 'gradient'] },
        seed: { type: 'string' },
        scale: { type: 'number' },
        surface: { type: 'boolean' },
        selection: { type: 'boolean' }
      },
      required: ['palette']
    }
  },
  {
    name: 'export_schematic',
    description: 'Encode the world as .bloxdschem. If it needs more than 160 Bloxd chunks it is split into named parts (name_part001_x0_z64.bloxdschem) plus a ZIP, manifest and placement guide. Never refuses a build for size.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        maxChunks: { type: 'number', description: '1–160, default 160.' }
      }
    }
  },
  {
    name: 'import_schematic',
    description: 'Import a .bloxdschem given as base64. Offsets in the filename (_x _z _y) are honoured.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string' },
        base64: { type: 'string' }
      },
      required: ['base64']
    }
  },
  {
    name: 'mesh_add',
    description: 'Add a decorative mesh part. type BloxdBlock (official block texture) or Box (solid RGB colour). Coordinates are in blocks, origin at the model feet. Size can be fractional.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['BloxdBlock', 'Box'] },
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' }, depth: { type: 'number' },
        size: { type: 'number', description: 'Uniform size shortcut.' },
        yaw: { type: 'number', description: 'Y rotation in degrees, snapped to 90.' },
        block: { type: 'string', description: 'Required for BloxdBlock.' },
        color: { type: 'string', description: '#RRGGBB for Box.' },
        texture: { type: 'string', description: 'Optional Box texture (a block name).' },
        name: { type: 'string' }
      }
    }
  },
  {
    name: 'mesh_update',
    description: 'Move, resize, recolor or swap the block of a mesh part.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' }, depth: { type: 'number' },
        size: { type: 'number' },
        yaw: { type: 'number' },
        block: { type: 'string' },
        color: { type: 'string' }
      },
      required: ['id']
    }
  },
  {
    name: 'mesh_remove',
    description: 'Delete a mesh part by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  },
  {
    name: 'mesh_duplicate',
    description: 'Duplicate a mesh part, offset in blocks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' }
      },
      required: ['id']
    }
  },
  {
    name: 'mesh_list',
    description: 'List every mesh part with ids, transforms and materials.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'export_mesh_code',
    description: 'Export the mesh as JavaScript to paste into Bloxd World Code (default) or a Code Block. Meshes are decorative entities, not terrain.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['world', 'codeblock'] },
        origin: { type: 'array', items: { type: 'number' }, description: 'World-code spawn [x,y,z].' },
        clearance: { type: 'number', description: 'Code-block clearance 1–32.' },
        name: { type: 'string' }
      }
    }
  }
]

function handlers(session) {
  const world = session.world
  const mesh = session.mesh

  return {
    new_project(args) {
      const name = args.name || 'Untitled'
      const what = args.what || 'both'
      if (what !== 'mesh') {
        world.clear()
        world.name = name
      }
      if (what !== 'world') {
        mesh.clear()
        mesh.name = name
      }
      session.name = name
      return ok({ name, world: world.stats(), mesh: mesh.stats() })
    },
    get_stats() {
      return ok({ world: world.stats(), mesh: mesh.stats() })
    },
    lookup_block(args) {
      return ok({ results: catalog.searchBlocks(args.query, args.limit || 20) })
    },
    nearest_block(args) {
      return ok(catalog.nearestColor(args.color, args.family || 'safe'))
    },
    set_block(args) {
      const resolved = catalog.resolveBlock(args.block)
      world.set(args.x, args.y, args.z, resolved.id)
      world.commit('Set block')
      return ok({ at: [args.x, args.y, args.z], block: resolved, total: world.size })
    },
    set_blocks(args) {
      const list = args.blocks || []
      let count = 0
      list.forEach(entry => {
        if (!Array.isArray(entry) || entry.length < 4) return
        const resolved = catalog.resolveBlock(entry[3])
        world.set(entry[0], entry[1], entry[2], resolved.id)
        count++
      })
      world.commit('Set blocks')
      return ok({ count, total: world.size })
    },
    get_block(args) {
      const id = world.get(args.x, args.y, args.z)
      return ok({
        at: [args.x, args.y, args.z],
        id,
        name: catalog.ID_TO_NAME[id] || (id ? `Block ${id}` : 'Air'),
        hex: id ? catalog.hexString(id) : '#000000'
      })
    },
    fill_box(args) {
      const id = blockId(args.block)
      const result = world.fillBox(vec3(args.a, 'a'), vec3(args.b, 'b'), id, !!args.hollow)
      return ok({ ...result, block: catalog.ID_TO_NAME[id], total: world.size, chunks: world.chunkCounts() })
    },
    fill_sphere(args) {
      const id = blockId(args.block)
      const result = world.fillSphere(args.x, args.y, args.z, args.radius, id, !!args.hollow)
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    fill_ellipsoid(args) {
      const id = blockId(args.block)
      const result = world.fillEllipsoid(args.x, args.y, args.z, args.rx, args.ry, args.rz, id, !!args.hollow)
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    fill_cylinder(args) {
      const id = blockId(args.block)
      const result = world.fillCylinder(args.x, args.y, args.z, args.radius, args.height, id, !!args.hollow, args.axis || 'y')
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    draw_line(args) {
      const id = blockId(args.block)
      const result = world.drawLine(vec3(args.a, 'a'), vec3(args.b, 'b'), id, args.radius || 0)
      return ok({ ...result, total: world.size })
    },
    draw_ring(args) {
      const id = blockId(args.block)
      const result = world.drawRing(args.x, args.y, args.z, args.radius, id, args.thickness || 1, args.axis || 'y')
      return ok({ ...result, total: world.size })
    },
    draw_cone(args) {
      const id = blockId(args.block)
      const result = world.drawCone(args.x, args.y, args.z, args.radius, args.height, id)
      return ok({ ...result, total: world.size })
    },
    draw_pyramid(args) {
      const id = blockId(args.block)
      const result = world.drawPyramid(args.x, args.y, args.z, args.size, args.height, id, !!args.hollow)
      return ok({ ...result, total: world.size })
    },
    flood_fill(args) {
      const id = blockId(args.block)
      return ok({ ...world.floodFill(args.x, args.y, args.z, id, args.limit || 100000), total: world.size })
    },
    replace_blocks(args) {
      const from = blockId(args.from)
      const to = blockId(args.to)
      const region = args.a && args.b
        ? { min: vec3(args.a, 'a').map((v, i) => Math.min(v, args.b[i])), max: vec3(args.a, 'a').map((v, i) => Math.max(v, args.b[i])) }
        : null
      return ok({ ...world.replace(from, to, region), total: world.size })
    },
    remove_region(args) {
      return ok({ ...world.removeRegion(vec3(args.a, 'a'), vec3(args.b, 'b')), total: world.size })
    },
    select_box(args) {
      return ok(world.selectBox(vec3(args.a, 'a'), vec3(args.b, 'b'), !!args.additive))
    },
    select_connected(args) {
      return ok(world.selectConnected(args.x, args.y, args.z, !!args.additive))
    },
    copy_selection() { return ok(world.copySelection()) },
    cut_selection() { return ok(world.cutSelection()) },
    paste(args) { return ok({ ...world.paste([args.x, args.y, args.z]), total: world.size }) },
    delete_selection() { return ok({ ...world.deleteSelection(), total: world.size }) },
    move_selection(args) { return ok(world.moveSelection(args.dx || 0, args.dy || 0, args.dz || 0)) },
    rotate_selection(args) { return ok(world.rotateSelection(args.axis || 'y', args.clockwise !== false)) },
    mirror_selection(args) { return ok(world.mirrorSelection(args.axis || 'x')) },
    hollow_selection() { return ok(world.hollowSelection()) },
    dilate_selection() { return ok(world.dilateSelection()) },
    erode_selection() { return ok(world.erodeSelection()) },
    smooth_selection() { return ok(world.smoothSelection()) },
    extrude_selection(args) { return ok(world.extrudeSelection(args.dx || 0, args.dy == null ? 1 : args.dy, args.dz || 0)) },
    undo() { return ok(world.undo()) },
    redo() { return ok(world.redo()) },
    terrain_brush(args) {
      const result = world.terrainBrush([args.x, args.y, args.z], {
        tool: args.tool,
        radius: args.radius,
        strength: args.strength,
        biome: args.biome,
        falloff: args.falloff,
        depth: args.depth,
        seed: args.seed,
        density: args.density,
        water: args.water
      })
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    generate_structure(args) {
      const extra = args.extra && typeof args.extra === 'object' ? args.extra : {}
      const result = world.generate(args.type, {
        size: args.size,
        height: args.height,
        seed: args.seed,
        ...extra
      }, {
        x: args.x || 0,
        y: args.y || 0,
        z: args.z || 0,
        blocksPerUnit: args.blocksPerUnit || 2
      })
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    apply_texture(args) {
      const palette = (args.palette || []).map(item => {
        if (typeof item === 'string' || typeof item === 'number') return { id: catalog.resolveBlock(item).id, weight: 1 }
        return { id: catalog.resolveBlock(item.id || item.block || item.name).id, weight: item.weight || 1 }
      })
      const result = world.applyTexture({
        palette,
        mode: args.mode || 'fbm',
        seed: args.seed,
        scale: args.scale,
        surface: !!args.surface,
        selection: !!args.selection
      })
      return ok({ changed: result.changed, total: world.size })
    },
    export_schematic(args) {
      const name = args.name || world.name || session.name || 'Bloxd Build'
      const result = world.exportSchematic(name, { maxChunks: args.maxChunks || 160, allowSplit: true })
      const dest = path.join(EXPORTS, session.id)
      const written = writeExportFiles(result, name, dest)
      const publicFiles = (written.files || []).map(file => ({
        name: file.name,
        bytes: file.bytes,
        chunks: file.chunks,
        download: `/exports/${session.id}/${file.name}`
      }))
      const payload = {
        mode: result.mode,
        name,
        blocks: result.blockCount,
        size: result.size,
        chunks: result.mode === 'single' ? result.chunks : result.plan && result.plan.totalChunks,
        overLimit: !!result.overLimit,
        parts: result.mode === 'split' ? result.parts : 1,
        largestPart: result.largestPart || result.chunks,
        files: publicFiles,
        zip: written.zipName ? { name: written.zipName, download: `/exports/${session.id}/${written.zipName}` } : null,
        guide: result.mode === 'split' ? 'Place every part at the x/y/z encoded in its filename (also listed in GUIDE_IMPORTATION.txt).' : 'Load the single .bloxdschem in Bloxd with //schematic load.',
        note: result.mode === 'split'
          ? `Build needs more than 160 chunks so it was split into ${result.parts} files, each ≤ 160 chunks.`
          : 'Single file is within Bloxd\'s 160-chunk limit.'
      }
      if (result.mode === 'single' && result.bytes && result.bytes.length < 180000) {
        payload.base64 = Buffer.from(result.bytes).toString('base64')
      }
      return ok(payload)
    },
    import_schematic(args) {
      const bytes = Buffer.from(args.base64, 'base64')
      const result = world.importSchematic(bytes, args.filename)
      return ok({ ...result, total: world.size, chunks: world.chunkCounts() })
    },
    mesh_add(args) {
      const part = mesh.addPart(args)
      return ok({ part, stats: mesh.stats() })
    },
    mesh_update(args) {
      const part = mesh.update(args.id, args)
      return ok({ part, stats: mesh.stats() })
    },
    mesh_remove(args) {
      const part = mesh.remove(args.id)
      return ok({ removed: part.id, stats: mesh.stats() })
    },
    mesh_duplicate(args) {
      const part = mesh.duplicate(args.id, [args.dx || 1, args.dy || 0, args.dz || 0])
      return ok({ part, stats: mesh.stats() })
    },
    mesh_list() {
      return ok({ parts: mesh.list(), stats: mesh.stats() })
    },
    export_mesh_code(args) {
      const exported = mesh.exportCode({
        mode: args.mode || 'world',
        origin: args.origin,
        clearance: args.clearance,
        name: args.name || mesh.name
      })
      const dest = path.join(EXPORTS, session.id)
      fs.mkdirSync(dest, { recursive: true })
      fs.writeFileSync(path.join(dest, exported.filename), exported.code)
      return ok({
        ...exported,
        download: `/exports/${session.id}/${exported.filename}`,
        how: exported.mode === 'world'
          ? 'Paste the code into Bloxd World Code. The model spawns once at ORIGIN when the first player joins.'
          : 'Paste into a Code Block, close it, then right-click the block. The model appears in front of you.'
      })
    }
  }
}

function callTool(session, name, args) {
  const map = handlers(session)
  if (!map[name]) throw new Error(`Unknown tool "${name}".`)
  return map[name](args || {})
}

module.exports = { TOOLS, callTool, handlers, EXPORTS }
