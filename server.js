#!/usr/bin/env node
'use strict'

if (process.argv.includes('--stdio') || process.argv.includes('stdio')) {
  require('./src/mcp').createStdioServer()
} else {
  require('./src/http-server').listen()
}
