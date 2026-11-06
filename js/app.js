/* Bloxd MCP website — builder, mesh studio, MCP docs. */
(function () {
  'use strict'

  const NAME_TO_ID = window.BLOXD_NAME_TO_ID || {}
  const ID_TO_NAME = window.BLOXD_ID_TO_NAME || {}
  if (window.BloxdBlockColors) window.BloxdBlockColors.init(NAME_TO_ID)

  const PALETTE = [
    'Stone', 'Grass Block', 'Dirt', 'Sand', 'Maple Wood Planks', 'Maple Log', 'Maple Leaves',
    'Bricks', 'Stone Bricks', 'Glass', 'Water', 'White Concrete', 'Black Concrete',
    'Red Concrete', 'Blue Concrete', 'Block of Gold', 'Block of Iron', 'Block of Quartz'
  ].filter(n => NAME_TO_ID[n] != null)

  const keyOf = (x, y, z) => `${x|0},${y|0},${z|0}`
  const parseKey = k => k.split(',').map(Number)
  const hexOf = id => window.BloxdBlockColors ? window.BloxdBlockColors.hex(id) : ((id * 2654435761) & 0xffffff)

  function resolveBlock(input) {
    if (NAME_TO_ID[input] != null) return { id: NAME_TO_ID[input], name: input }
    const hit = Object.keys(NAME_TO_ID).find(n => n.toLowerCase() === String(input).toLowerCase())
    if (hit) return { id: NAME_TO_ID[hit], name: hit }
    if (/^\d+$/.test(String(input))) return { id: Number(input), name: ID_TO_NAME[input] || String(input) }
    return { id: 28, name: 'Stone' }
  }

  /* ------------------------------------------------------------------ */
  /* World                                                             */
  /* ------------------------------------------------------------------ */
  const world = {
    blocks: new Map(),
    history: [],
    name: 'My_Build',
    current: resolveBlock('Stone'),
    tool: 'place',
    commit() {
      this.history.push(new Map(this.blocks))
      if (this.history.length > 24) this.history.shift()
    },
    undo() {
      this.history.pop()
      const prev = this.history[this.history.length - 1]
      if (prev) this.blocks = new Map(prev)
      else this.blocks = new Map()
    },
    set(x, y, z, id) {
      if (!id) this.blocks.delete(keyOf(x, y, z))
      else this.blocks.set(keyOf(x, y, z), id)
    },
    fillBox(a, b, id, hollow) {
      const min = a.map((v, i) => Math.min(v, b[i]))
      const max = a.map((v, i) => Math.max(v, b[i]))
      for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) {
        if (hollow && x > min[0] && x < max[0] && y > min[1] && y < max[1] && z > min[2] && z < max[2]) continue
        this.set(x, y, z, id)
      }
    },
    sphere(c, r, id, hollow) {
      const rr = r * r, inner = (r - 1) * (r - 1)
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
        const d = x * x + y * y + z * z
        if (d > rr || (hollow && d < inner)) continue
        this.set(c[0] + x, c[1] + y, c[2] + z, id)
      }
    },
    line(a, b, id) {
      const d = b.map((v, i) => v - a[i])
      const steps = Math.max(1, ...d.map(Math.abs))
      for (let i = 0; i <= steps; i++) this.set(Math.round(a[0] + d[0] * i / steps), Math.round(a[1] + d[1] * i / steps), Math.round(a[2] + d[2] * i / steps), id)
    },
    bounds() {
      if (!this.blocks.size) return null
      const pts = [...this.blocks.keys()].map(parseKey)
      const min = [0, 1, 2].map(i => Math.min(...pts.map(p => p[i])))
      const max = [0, 1, 2].map(i => Math.max(...pts.map(p => p[i])))
      return { min, max, size: max.map((v, i) => v - min[i] + 1) }
    },
    chunks() {
      const b = this.bounds()
      if (!b) return 0
      return Math.ceil(b.size[0] / 32) * Math.ceil(b.size[1] / 32) * Math.ceil(b.size[2] / 32)
    }
  }

  const mesh = {
    parts: [],
    selected: null,
    add(part) {
      part.id = 'p' + Math.random().toString(36).slice(2, 7)
      this.parts.push(part)
      this.selected = part.id
      return part
    }
  }

  function log(el, msg) {
    const node = document.getElementById(el)
    if (!node) return
    node.textContent = (new Date().toLocaleTimeString() + '  ' + msg + '\n' + node.textContent).slice(0, 4000)
  }

  /* ------------------------------------------------------------------ */
  /* Three.js helpers                                                  */
  /* ------------------------------------------------------------------ */
  function makeScene(canvas, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(opts.bg || 0x08140f)
    scene.fog = new THREE.Fog(opts.bg || 0x08140f, 40, 180)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 800)
    camera.position.set(18, 14, 22)
    const sun = new THREE.DirectionalLight(0xfff4d2, 1.15)
    sun.position.set(20, 30, 10)
    scene.add(sun, new THREE.AmbientLight(0x7fb89a, 0.55), new THREE.HemisphereLight(0xb7e7ff, 0x1c3a28, 0.35))
    const grid = new THREE.GridHelper(64, 64, 0x3ee08a, 0x1c3a28)
    grid.material.transparent = true
    grid.material.opacity = 0.28
    scene.add(grid)
    const pivot = new THREE.Object3D()
    scene.add(pivot)
    const state = { yaw: 0.7, pitch: 0.5, dist: 28, pan: new THREE.Vector3(0, 4, 0), dragging: false, button: 0, last: [0, 0] }
    function resize() {
      const w = canvas.clientWidth || canvas.parentElement.clientWidth
      const h = canvas.clientHeight || canvas.parentElement.clientHeight || 420
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    function frame() {
      camera.position.set(
        state.pan.x + Math.cos(state.yaw) * Math.cos(state.pitch) * state.dist,
        state.pan.y + Math.sin(state.pitch) * state.dist,
        state.pan.z + Math.sin(state.yaw) * Math.cos(state.pitch) * state.dist
      )
      camera.lookAt(state.pan)
      renderer.render(scene, camera)
      requestAnimationFrame(frame)
    }
    canvas.addEventListener('pointerdown', e => { state.dragging = true; state.button = e.button; state.last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId) })
    canvas.addEventListener('pointerup', () => { state.dragging = false })
    canvas.addEventListener('pointermove', e => {
      if (!state.dragging) return
      const dx = e.clientX - state.last[0], dy = e.clientY - state.last[1]
      state.last = [e.clientX, e.clientY]
      if (state.button === 2 || e.shiftKey) {
        state.pan.x -= dx * 0.04
        state.pan.y += dy * 0.04
      } else {
        state.yaw += dx * 0.01
        state.pitch = Math.max(-1.2, Math.min(1.4, state.pitch + dy * 0.01))
      }
    })
    canvas.addEventListener('contextmenu', e => e.preventDefault())
    canvas.addEventListener('wheel', e => { state.dist = Math.max(6, Math.min(160, state.dist + e.deltaY * 0.04)); e.preventDefault() }, { passive: false })
    window.addEventListener('resize', resize)
    resize()
    frame()
    return { scene, camera, renderer, pivot, state, resize }
  }

  function rebuildWorld(ctx) {
    while (ctx.pivot.children.length) {
      const child = ctx.pivot.children.pop()
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    }
    const grouped = new Map()
    let n = 0
    world.blocks.forEach((id, key) => {
      if (n++ > 50000) return
      if (!grouped.has(id)) grouped.set(id, [])
      grouped.get(id).push(parseKey(key))
    })
    const m = new THREE.Matrix4()
    grouped.forEach((pts, id) => {
      const geo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshStandardMaterial({ color: hexOf(id), roughness: 0.78, metalness: 0.04 })
      const mesh3 = new THREE.InstancedMesh(geo, mat, pts.length)
      pts.forEach((p, i) => { m.makeTranslation(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5); mesh3.setMatrixAt(i, m) })
      ctx.pivot.add(mesh3)
    })
  }

  function rebuildMesh(ctx) {
    while (ctx.pivot.children.length) {
      const child = ctx.pivot.children.pop()
      if (child.geometry) child.geometry.dispose()
      if (child.material) child.material.dispose()
    }
    mesh.parts.forEach(part => {
      const geo = new THREE.BoxGeometry(part.w, part.h, part.d)
      const color = part.type === 'Box' ? part.color : hexOf(part.blockId || 28)
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: part.type === 'Box' ? 0.08 : 0.02 })
      const obj = new THREE.Mesh(geo, mat)
      obj.position.set(part.x, part.y + part.h / 2, part.z)
      if (mesh.selected === part.id) {
        const hl = new THREE.BoxHelper(obj, 0xf3d04a)
        ctx.pivot.add(hl)
      }
      ctx.pivot.add(obj)
    })
  }

  /* ------------------------------------------------------------------ */
  /* Demo house for the hero                                           */
  /* ------------------------------------------------------------------ */
  function demoHouse() {
    world.blocks.clear()
    const oak = resolveBlock('Maple Wood Planks').id
    const log = resolveBlock('Maple Log').id
    const roof = resolveBlock('Bricks').id
    const grass = resolveBlock('Grass Block').id
    const glass = resolveBlock('Glass').id
    const stone = resolveBlock('Stone').id
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) world.set(x, 0, z, grass)
    world.fillBox([-4, 1, -4], [4, 4, 4], oak, true)
    world.fillBox([-4, 1, -4], [4, 1, 4], oak, false)
    ;[[-4, 1, -4], [4, 1, -4], [-4, 1, 4], [4, 1, 4]].forEach(p => {
      for (let y = 1; y <= 5; y++) world.set(p[0], y, p[2], log)
    })
    for (let y = 0; y < 4; y++) {
      const s = 5 - y
      world.fillBox([-s, 5 + y, -s], [s, 5 + y, s], roof, y < 3)
    }
    world.set(0, 2, -4, glass)
    world.set(-1, 2, -4, glass)
    world.set(1, 2, -4, glass)
    world.set(0, 1, -4, 0)
    world.set(0, 2, 4, glass)
    world.fillBox([-2, 1, 6], [2, 1, 10], stone, false)
    world.commit()
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                             */
  /* ------------------------------------------------------------------ */
  const views = [...document.querySelectorAll('.view')]
  function show(name) {
    views.forEach(v => v.classList.toggle('active', v.id === name))
    document.querySelectorAll('[data-view]').forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-view') === name))
    if (name === 'builder' && worldCtx) worldCtx.resize()
    if (name === 'mesh' && meshCtx) meshCtx.resize()
    if (name === 'home' && heroCtx) heroCtx.resize()
  }
  document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault()
    show(el.getAttribute('data-view'))
  }))

  const heroCtx = makeScene(document.getElementById('hero-canvas'), { bg: 0x08140f })
  const worldCtx = makeScene(document.getElementById('world-canvas'))
  const meshCtx = makeScene(document.getElementById('mesh-canvas'))

  demoHouse()
  rebuildWorld(heroCtx)
  rebuildWorld(worldCtx)
  heroCtx.state.dist = 22
  heroCtx.state.pan.set(0, 3, 0)

  /* ------------------------------------------------------------------ */
  /* Builder UI                                                        */
  /* ------------------------------------------------------------------ */
  const tools = [
    ['place', 'Place'], ['remove', 'Remove'], ['paint', 'Paint'],
    ['box', 'Box'], ['shell', 'Shell'], ['sphere', 'Sphere'], ['line', 'Line']
  ]
  const toolBox = document.getElementById('world-tools')
  tools.forEach(([id, label]) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => { world.tool = id; [...toolBox.children].forEach(x => x.classList.toggle('active', x === b)) }
    if (id === 'place') b.classList.add('active')
    toolBox.appendChild(b)
  })

  const paletteEl = document.getElementById('palette')
  function renderPalette(names) {
    paletteEl.innerHTML = ''
    names.slice(0, 32).forEach(name => {
      const id = NAME_TO_ID[name]
      const s = document.createElement('button')
      s.className = 'swatch'
      s.title = name
      s.style.background = '#' + hexOf(id).toString(16).padStart(6, '0')
      s.onclick = () => {
        world.current = { id, name }
        ;[...paletteEl.children].forEach(x => x.classList.toggle('active', x === s))
      }
      if (name === world.current.name) s.classList.add('active')
      paletteEl.appendChild(s)
    })
  }
  renderPalette(PALETTE)
  document.getElementById('block-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase()
    if (!q) return renderPalette(PALETTE)
    const names = Object.keys(NAME_TO_ID).filter(n => n.toLowerCase().includes(q) && NAME_TO_ID[n]).slice(0, 32)
    renderPalette(names.length ? names : PALETTE)
    const exact = resolveBlock(e.target.value)
    world.current = exact
  })

  let anchor = null
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  document.getElementById('world-canvas').addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    const rect = e.target.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, worldCtx.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, hit)
    const p = [Math.round(hit.x), Math.max(0, Math.round(hit.y)), Math.round(hit.z)]
    const size = Math.max(1, Number(document.getElementById('brush-size').value) || 6)
    const id = world.current.id
    if (world.tool === 'place') world.set(p[0], 1, p[2], id)
    else if (world.tool === 'remove') world.set(p[0], 1, p[2], 0)
    else if (world.tool === 'paint') world.set(p[0], 1, p[2], id)
    else if (world.tool === 'box' || world.tool === 'shell') {
      if (!anchor) { anchor = p; log('world-log', 'Corner 1 ' + p); return }
      world.fillBox(anchor, [p[0], p[1] + size, p[2]], id, world.tool === 'shell')
      anchor = null
    } else if (world.tool === 'sphere') world.sphere([p[0], p[1] + size, p[2]], size, id, false)
    else if (world.tool === 'line') {
      if (!anchor) { anchor = p; log('world-log', 'Line start ' + p); return }
      world.line(anchor, p, id)
      anchor = null
    }
    world.commit()
    refreshWorld()
  })

  function refreshWorld() {
    rebuildWorld(worldCtx)
    rebuildWorld(heroCtx)
    const chunks = world.chunks()
    document.getElementById('world-hud').textContent = `${world.blocks.size.toLocaleString()} blocks · ${chunks} chunks`
    const warn = document.getElementById('chunk-warn')
    warn.textContent = chunks > 160
      ? `${chunks} chunks — above Bloxd's 160 limit. Export will split into parts.`
      : chunks ? `${chunks} / 160 chunks` : ''
  }
  refreshWorld()

  document.getElementById('btn-undo').onclick = () => { world.undo(); refreshWorld(); log('world-log', 'Undo') }
  document.getElementById('btn-clear-world').onclick = () => { world.blocks.clear(); world.commit(); refreshWorld(); log('world-log', 'Cleared') }
  document.getElementById('btn-generate').onclick = () => {
    const type = document.getElementById('gen-type').value
    if (!window.BloxdProceduralGenerators) return log('world-log', 'Generator missing')
    const writer = window.BloxdProceduralGenerators.localGenerate({ type, seed: Date.now(), size: 10, height: 8 }, { blocksPerUnit: 2, maxBlocks: 80000 })
    writer.blocks.forEach((id, k) => {
      const [x, y, z] = parseKey(k)
      world.set(x, y, z, id)
    })
    world.commit()
    refreshWorld()
    log('world-log', `Generated ${type} · ${writer.blocks.size} blocks`)
  }

  function downloadBytes(bytes, name, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  document.getElementById('btn-export-schem').onclick = () => {
    if (!world.blocks.size) return log('world-log', 'Nothing to export')
    const name = document.getElementById('schem-name').value || 'My_Build'
    const result = window.BloxdSchemSplitter.encodeVoxelMapForBloxd(world.blocks, { name, maxChunks: 160, allowSplit: true })
    if (result.mode === 'single') {
      downloadBytes(result.bytes, name.replace(/\s+/g, '_') + '.bloxdschem')
      log('world-log', `Exported ${result.blockCount} blocks · ${result.chunks} chunks`)
    } else {
      downloadBytes(result.zip, name.replace(/\s+/g, '_') + '.zip', 'application/zip')
      log('world-log', `Split into ${result.parts} files (largest ${result.largestPart} chunks). ZIP downloaded.`)
    }
  }

  /* ------------------------------------------------------------------ */
  /* Mesh studio                                                       */
  /* ------------------------------------------------------------------ */
  function refreshMesh() {
    rebuildMesh(meshCtx)
    document.getElementById('mesh-hud').textContent = mesh.parts.length + ' parts'
    const list = document.getElementById('mesh-list')
    list.innerHTML = ''
    mesh.parts.forEach(part => {
      const row = document.createElement('div')
      row.className = 'part' + (mesh.selected === part.id ? ' active' : '')
      const color = part.type === 'Box' ? part.color : hexOf(part.blockId || 28)
      row.innerHTML = `<span class="dot" style="background:#${Number(color).toString(16).padStart(6, '0')}"></span><span>${part.type === 'Box' ? 'Box' : part.block} · ${part.w}×${part.h}×${part.d}</span><button class="btn btn-ghost">✕</button>`
      row.onclick = () => { mesh.selected = part.id; refreshMesh() }
      row.querySelector('button').onclick = ev => {
        ev.stopPropagation()
        mesh.parts = mesh.parts.filter(p => p.id !== part.id)
        refreshMesh()
        updateMeshCode()
      }
      list.appendChild(row)
    })
    updateMeshCode()
  }

  mesh.add({ type: 'BloxdBlock', block: 'Block of Gold', blockId: NAME_TO_ID['Block of Gold'] || 48, x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 })
  mesh.add({ type: 'Box', color: 0xea7e35, x: 1.4, y: 0, z: 0, w: 1.6, h: 0.35, d: 0.35 })
  refreshMesh()

  document.getElementById('btn-add-mesh').onclick = () => {
    const type = document.getElementById('mesh-type').value
    const w = Number(document.getElementById('mesh-w').value) || 1
    const h = Number(document.getElementById('mesh-h').value) || 1
    const d = Number(document.getElementById('mesh-d').value) || 1
    const n = mesh.parts.length
    const part = {
      type,
      x: (n % 4) * 1.4,
      y: 0,
      z: Math.floor(n / 4) * 1.4,
      w, h, d
    }
    if (type === 'Box') {
      part.color = parseInt(document.getElementById('mesh-color').value.slice(1), 16)
    } else {
      const b = resolveBlock(document.getElementById('mesh-block').value)
      part.block = b.name
      part.blockId = b.id
    }
    mesh.add(part)
    refreshMesh()
  }

  function meshCode() {
    const mode = document.getElementById('mesh-mode').value
    const tag = 'Mesh'
    const lines = []
    if (mode === 'world') {
      lines.push('// Bloxd MCP mesh — paste into World Code.')
      lines.push('var ORIGIN_Mesh = [0, 8, 0];')
      lines.push('var spawned_Mesh = false;')
      lines.push('function spawn_Mesh(ox, oy, oz) {')
    } else {
      lines.push('// Bloxd MCP mesh — paste into a Code Block, then right-click it.')
      lines.push('var _pos = thisPos;')
      lines.push('var _info = api.getPlayerFacingInfo(myId);')
      lines.push('var _dir = _info && _info.dir ? _info.dir : [0, 0, 1];')
      lines.push('var ox = _pos[0] + _dir[0] * 4;')
      lines.push('var oy = _pos[1];')
      lines.push('var oz = _pos[2] + _dir[2] * 4;')
      lines.push('(function spawn_Mesh(ox, oy, oz) {')
    }
    lines.push('  function _mesh(type, opts, x, y, z) {')
    lines.push('    var id = api.attemptCreateMeshEntity(type, opts);')
    lines.push('    if (id) api.setPosition(id, ox + x, oy + y, oz + z);')
    lines.push('  }')
    mesh.parts.forEach(part => {
      if (part.type === 'Box') {
        const r = (part.color >> 16) & 255, g = (part.color >> 8) & 255, b = part.color & 255
        lines.push(`  _mesh("Box", { width: ${part.w}, height: ${part.h}, depth: ${part.d}, diffuseColor: [${r}, ${g}, ${b}] }, ${part.x}, ${part.y}, ${part.z});`)
      } else {
        const size = (part.w === part.h && part.h === part.d) ? part.w : `[${part.w}, ${part.h}, ${part.d}]`
        lines.push(`  _mesh("BloxdBlock", { blockName: ${JSON.stringify(part.block)}, size: ${size} }, ${part.x}, ${part.y}, ${part.z});`)
      }
    })
    if (mode === 'world') {
      lines.push('}')
      lines.push('function onPlayerJoin(playerId) {')
      lines.push('  if (spawned_Mesh) return;')
      lines.push('  spawned_Mesh = true;')
      lines.push('  spawn_Mesh(ORIGIN_Mesh[0], ORIGIN_Mesh[1], ORIGIN_Mesh[2]);')
      lines.push('}')
    } else lines.push('})(ox, oy, oz);')
    return lines.join('\n') + '\n'
  }

  function updateMeshCode() {
    document.getElementById('mesh-code').textContent = mesh.parts.length ? meshCode() : '// Add parts, then export.'
  }
  document.getElementById('mesh-mode').onchange = updateMeshCode
  document.getElementById('btn-export-mesh').onclick = () => {
    const blob = new Blob([meshCode()], { type: 'text/javascript' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'bloxd-mesh-' + document.getElementById('mesh-mode').value + '.js'
    a.click()
  }
  document.getElementById('btn-copy-mesh').onclick = () => navigator.clipboard.writeText(meshCode())

  /* ------------------------------------------------------------------ */
  /* MCP docs                                                          */
  /* ------------------------------------------------------------------ */
  const origin = location.origin
  const pagesHost = /\.github\.io$/i.test(location.hostname)
  const mcpUrl = pagesHost
    ? 'GitHub Pages is static — it cannot run the MCP process.\nUse stdio locally:  node server.js --stdio'
    : origin + '/mcp'
  document.getElementById('mcp-url').textContent = mcpUrl
  document.getElementById('mcp-stdio').textContent = JSON.stringify({
    mcpServers: {
      bloxd: {
        command: 'node',
        args: ['/absolute/path/to/bloxd-MCP/server.js', '--stdio']
      }
    }
  }, null, 2)
  document.getElementById('mcp-http').textContent = pagesHost
    ? 'HTTP MCP needs Node (node server.js). GitHub Pages only hosts the studio.'
    : JSON.stringify({ mcpServers: { bloxd: { url: origin + '/mcp' } } }, null, 2)
  document.getElementById('btn-copy-url').onclick = () => {
    navigator.clipboard.writeText(pagesHost ? 'node server.js --stdio' : origin + '/mcp')
  }
  const showTools = data => {
    document.getElementById('tool-list-preview').textContent = (data.tools || []).map(t => t.name + ' — ' + t.description).join('\n')
  }
  fetch('tools.json').then(r => r.ok ? r.json() : Promise.reject()).then(showTools).catch(() => {
    fetch('/api/tools').then(r => r.json()).then(showTools).catch(() => {
      document.getElementById('tool-list-preview').textContent = 'Could not load the tool list.'
    })
  })

  window.BloxdStudio = { world, mesh, refreshWorld, refreshMesh }
})()
