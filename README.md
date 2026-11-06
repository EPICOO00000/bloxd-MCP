# Bloxd MCP

A website and a [Model Context Protocol](https://modelcontextprotocol.io) server that hands an AI the tools to **build Bloxd.io schematics and decorative meshes**.

- **Builds** export as real `.bloxdschem` files (Avro header, 32³ chunks, RLE).
- Anything above Bloxd's **160-chunk** limit is split into `name_part001_x0_z64.bloxdschem` parts, plus a ZIP, `manifest.json` and `GUIDE_IMPORTATION.txt`.
- **Meshes** export as JavaScript you paste into **Bloxd World Code** (or a Code Block). They spawn as `Box` / `BloxdBlock` mesh entities — decorative, not terrain.

The voxel tools, block catalog, schematic codec and 160-chunk splitter are the same ones used in [VoxelForge](https://epicoo00000.github.io/VoxelForge/).

## Host on GitHub Pages

GitHub Pages can host the **studio** (Builder + Mesh Studio + docs). It **cannot** run the MCP server — Pages only serves static files, no Node process.

### 1. Push the repo

```bash
git push origin main
```

### 2. Turn on Pages (Deploy from a branch)

1. Open the repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** `main` (or this branch)
   - **Folder:** `/docs`
3. Click **Save**.
4. Wait a minute. The studio is at:

```
https://<your-user>.github.io/bloxd-MCP/
```

The `/docs` folder is the static site (Builder, Mesh Studio, docs). Update `website/` then copy it into `docs/` before pushing if you change the UI.

### 3. MCP for the AI (not on Pages)

Clone the repo on your machine and point Claude Desktop / Cursor at stdio:

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

For a public HTTP MCP URL you need a Node host (Railway, Render, Fly.io, a VPS) running `node server.js` — GitHub Pages will not accept `/mcp` connections.

## Run the website + HTTP MCP locally

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
