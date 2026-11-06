# Bloxd MCP

A website and a [Model Context Protocol](https://modelcontextprotocol.io) server that hands an AI the tools to **build Bloxd.io schematics and decorative meshes**.

- **Builds** export as real `.bloxdschem` files (Avro header, 32³ chunks, RLE).
- Anything above Bloxd's **160-chunk** limit is split into `name_part001_x0_z64.bloxdschem` parts, plus a ZIP, `manifest.json` and `GUIDE_IMPORTATION.txt`.
- **Meshes** export as JavaScript you paste into **Bloxd World Code** (or a Code Block). They spawn as `Box` / `BloxdBlock` mesh entities — decorative, not terrain.

The voxel tools, block catalog, schematic codec and 160-chunk splitter are the same ones used in [VoxelForge](https://epicoo00000.github.io/VoxelForge/).

## Run the website + HTTP MCP

```bash
node server.js
```

Open `http://localhost:8787`.

| Path | What |
| --- | --- |
| `/` | Builder, Mesh Studio, MCP instructions |
| `/mcp` | Streamable HTTP MCP endpoint |
| `/api/tools` | JSON list of every tool |
| `/exports/<session>/…` | Downloaded schematics, ZIPs, mesh JS |

Bind address is `0.0.0.0` (override with `HOST` / `PORT`).

## Give it to an AI

### stdio (Claude Desktop, Cursor)

```bash
node server.js --stdio
```

```json
{
  "mcpServers": {
    "bloxd": {
      "command": "node",
      "args": ["/absolute/path/to/bloxd-MCP/server.js", "--stdio"]
    }
  }
}
```

### HTTP

```json
{
  "mcpServers": {
    "bloxd": {
      "url": "http://localhost:8787/mcp"
    }
  }
}
```

## What the model should do

1. `new_project` with a name.
2. `lookup_block` if a name is uncertain (2,090 official Bloxd names).
3. Build with `fill_box`, `fill_sphere`, `fill_cylinder`, `draw_line`, `terrain_brush`, `generate_structure`, …
4. `get_stats` to watch chunk count.
5. `export_schematic` — always succeeds; splits above 160 chunks.
6. For props / furniture / coloured models: `mesh_add` then `export_mesh_code` (`mode: "world"` by default).

## Tests

```bash
node tests/run.js
```

## License

GPL-2.0 (see `LICENSE`).
