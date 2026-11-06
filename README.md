# Bloxd MCP

A website and a [Model Context Protocol](https://modelcontextprotocol.io) server that hands an AI the tools to **build Bloxd.io schematics and decorative meshes**.

- **Builds** export as real `.bloxdschem` files (Avro header, 32³ chunks, RLE).
- Anything above Bloxd's **160-chunk** limit is split into `name_part001_x0_z64.bloxdschem` parts, plus a ZIP, `manifest.json` and `GUIDE_IMPORTATION.txt`.
- **Meshes** export as JavaScript you paste into **Bloxd World Code** (or a Code Block). They spawn as `Box` / `BloxdBlock` mesh entities — decorative, not terrain.

The voxel tools, block catalog, schematic codec and 160-chunk splitter are the same ones used in [VoxelForge](https://epicoo00000.github.io/VoxelForge/).

## Can GitHub host the MCP?

**No.** GitHub cannot run an MCP server.

| Thing | GitHub Pages | What you actually need |
| --- | --- | --- |
| Studio website (Builder, Mesh, export in the browser) | Yes — static files | Settings → Pages → branch `main` → folder `/` (root) |
| MCP for an AI (`/mcp`, stdio tools) | **No** — no Node process, no long-running server | Your PC: `node server.js --stdio`, or Railway / Render / Fly / a VPS for HTTP |

GitHub Pages is a file host, like a USB stick on the web. An MCP is a **program that stays running** and answers tool calls. Pages will never do that. There is no special “MCP format” GitHub accepts for this repo.

### Studio on Pages

`index.html` is at the **repo root**, which matches Pages source **branch `main` / folder `/`**.

1. Repo **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **`main`**
4. Folder: **`/` (root)** — not `/docs`
5. Save, wait ~1 minute
6. Open https://epicoo00000.github.io/bloxd-MCP/

### MCP for the AI (your machine)

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
