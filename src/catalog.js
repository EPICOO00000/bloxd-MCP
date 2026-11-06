'use strict'

require('../vendor/bloxd-block-catalog.js')
const colors = require('../vendor/bloxd-block-colors.js')
const matcher = require('../vendor/bloxd-color-matcher.js')
const texture = require('../vendor/bloxd-texture-engine.js')
const terrain = require('../vendor/bloxd-terrain-brush.js')
const procedural = require('../vendor/bloxd-procedural-generators.js')
const schematic = require('../vendor/bloxd-schematic.js')
const splitter = require('../vendor/bloxd-schematic-splitter.js')

global.BloxdBlockColors = global.BloxdBlockColors || colors
global.BloxdColorMatcher = global.BloxdColorMatcher || matcher
global.BloxdTextureEngine = global.BloxdTextureEngine || texture
global.BloxdTerrainBrush = global.BloxdTerrainBrush || terrain
global.BloxdProceduralGenerators = global.BloxdProceduralGenerators || procedural
global.BloxdSchematic = global.BloxdSchematic || schematic
global.BloxdSchemSplitter = global.BloxdSchemSplitter || splitter

const NAME_TO_ID = global.BLOXD_NAME_TO_ID
const ID_TO_NAME = global.BLOXD_ID_TO_NAME
colors.init(NAME_TO_ID)

const SAFE_EXCLUDE = /\|meta\||spawn orb|bow|sword|pickaxe|axe|shovel|hoe|shears|helmet|chestplate|leggings|boots|potion|ball$|bomb|gun|arrow|compass|bucket|boat|glider|name tag|unloaded|air$|placeholder|unused|internal_mesh|charging|projectile|protector|orb$/i

const BUILDING_BLOCKS = [
  'Stone', 'Smooth Stone', 'Messy Stone', 'Cobblestone',
  'Dirt', 'Messy Dirt', 'Grass Block', 'Sand', 'Red Sand', 'Gravel', 'Clay', 'Snow',
  'Maple Log', 'Pine Log', 'Aspen Log', 'Cedar Log', 'Elm Log', 'Plum Log', 'Palm Log', 'Cherry Log',
  'Maple Wood Planks', 'Pine Wood Planks', 'Aspen Wood Planks', 'Cedar Wood Planks',
  'Elm Wood Planks', 'Plum Wood Planks', 'Palm Wood Planks', 'Cherry Wood Planks',
  'Maple Leaves', 'Pine Leaves', 'Aspen Leaves', 'Bricks', 'Stone Bricks',
  'Sandstone', 'Smooth Sandstone', 'Glass', 'Ice', 'Obsidian', 'Bedrock',
  'Block of Iron', 'Block of Gold', 'Block of Diamond', 'Block of Emerald', 'Block of Quartz',
  'White Wool', 'Orange Wool', 'Magenta Wool', 'Light Blue Wool', 'Yellow Wool', 'Lime Wool',
  'Pink Wool', 'Gray Wool', 'Light Gray Wool', 'Cyan Wool', 'Purple Wool', 'Blue Wool',
  'Brown Wool', 'Green Wool', 'Red Wool', 'Black Wool',
  'White Concrete', 'Orange Concrete', 'Magenta Concrete', 'Light Blue Concrete', 'Yellow Concrete',
  'Lime Concrete', 'Pink Concrete', 'Gray Concrete', 'Light Gray Concrete', 'Cyan Concrete',
  'Purple Concrete', 'Blue Concrete', 'Brown Concrete', 'Green Concrete', 'Red Concrete', 'Black Concrete',
  'Water', 'Lava', 'Magma', 'Cactus', 'Hay Bale', 'Bookshelf', 'Moonstone Ore'
].filter(name => NAME_TO_ID[name] != null)

const NAMES = Object.keys(NAME_TO_ID)
const LOWER = new Map(NAMES.map(name => [name.toLowerCase(), name]))

function hexOf(id) {
  return colors.hex(Number(id))
}

function hexString(id) {
  return '#' + hexOf(id).toString(16).padStart(6, '0')
}

function resolveBlock(input) {
  if (input == null || input === '') throw new Error('A block name or id is required.')
  if (typeof input === 'number' && Number.isFinite(input)) {
    const id = Math.floor(input)
    const name = ID_TO_NAME[id]
    if (!name) throw new Error(`Unknown block id ${id}.`)
    return { id, name }
  }
  const raw = String(input).trim()
  if (/^\d+$/.test(raw)) return resolveBlock(Number(raw))
  if (NAME_TO_ID[raw] != null) return { id: NAME_TO_ID[raw], name: raw }
  const exact = LOWER.get(raw.toLowerCase())
  if (exact) return { id: NAME_TO_ID[exact], name: exact }
  const matches = searchBlocks(raw, 8)
  if (matches.length === 1) return { id: matches[0].id, name: matches[0].name }
  if (matches.length) {
    const hint = matches.slice(0, 5).map(item => `${item.name} (#${item.id})`).join(', ')
    throw new Error(`Ambiguous block "${raw}". Did you mean: ${hint}?`)
  }
  throw new Error(`Unknown Bloxd block "${raw}". Use lookup_block to search the 2,090-name catalog.`)
}

function searchBlocks(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) {
    return BUILDING_BLOCKS.slice(0, limit).map(name => ({
      id: NAME_TO_ID[name],
      name,
      hex: hexString(NAME_TO_ID[name])
    }))
  }
  if (/^#?[0-9a-f]{6}$/i.test(q)) {
    const hex = parseInt(q.replace('#', ''), 16)
    const match = global.BloxdColorMatcher.nearest(hex, { family: 'safe' })
    return [match.best, match.second].filter(Boolean).slice(0, limit).map(item => ({
      id: item.id,
      name: item.name,
      hex: hexString(item.id),
      distance: item.distance
    }))
  }
  const scored = []
  for (const name of NAMES) {
    const id = NAME_TO_ID[name]
    if (!id) continue
    const lower = name.toLowerCase()
    let score = 0
    if (lower === q) score = 1000
    else if (lower.startsWith(q)) score = 800 - lower.length
    else if (lower.includes(q)) score = 500 - lower.length
    else continue
    if (SAFE_EXCLUDE.test(name)) score -= 50
    scored.push({ id, name, hex: hexString(id), score })
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return scored.slice(0, limit).map(({ score, ...rest }) => rest)
}

function nearestColor(color, family = 'safe') {
  const hex = typeof color === 'number' ? color : parseInt(String(color).replace('#', ''), 16)
  if (!Number.isFinite(hex)) throw new Error('Color must be #RRGGBB.')
  const result = global.BloxdColorMatcher.nearest(hex, { family })
  return {
    best: { id: result.best.id, name: result.best.name, hex: hexString(result.best.id), distance: result.best.distance },
    second: result.second ? { id: result.second.id, name: result.second.name, hex: hexString(result.second.id), distance: result.second.distance } : null
  }
}

function isSafeName(name) {
  return !SAFE_EXCLUDE.test(name)
}

module.exports = {
  NAME_TO_ID,
  ID_TO_NAME,
  BUILDING_BLOCKS,
  colors,
  hexOf,
  hexString,
  resolveBlock,
  searchBlocks,
  nearestColor,
  isSafeName
}
