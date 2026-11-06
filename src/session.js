'use strict'

const { VoxelWorld } = require('./world')
const { MeshProject } = require('./mesh')
const crypto = require('crypto')

const sessions = new Map()

function makeId() {
  return crypto.randomBytes(8).toString('hex')
}

class StudioSession {
  constructor(id) {
    this.id = id || makeId()
    this.name = 'Untitled'
    this.world = new VoxelWorld()
    this.mesh = new MeshProject()
    this.created = Date.now()
    this.touched = Date.now()
    this.listeners = new Set()
  }

  touch() {
    this.touched = Date.now()
  }

  emit(event, data) {
    this.listeners.forEach(fn => {
      try { fn(event, data) } catch (_err) { /* ignore */ }
    })
  }
}

function getSession(id) {
  if (id && sessions.has(id)) {
    const session = sessions.get(id)
    session.touch()
    return session
  }
  const session = new StudioSession(id)
  sessions.set(session.id, session)
  return session
}

function listSessions() {
  return [...sessions.values()].map(session => ({
    id: session.id,
    name: session.name,
    blocks: session.world.size,
    parts: session.mesh.parts.length,
    touched: session.touched
  }))
}

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6
  for (const [id, session] of sessions) {
    if (session.touched < cutoff && id !== 'studio') sessions.delete(id)
  }
}, 60 * 1000).unref()

module.exports = { getSession, listSessions, StudioSession, sessions }
