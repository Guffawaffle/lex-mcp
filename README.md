# @smartergpt/lex-mcp

Thin MCP stdio wrapper for [@smartergpt/lex](https://github.com/Guffawaffle/lex) episodic memory.

Lex owns all capabilities. This package owns delivery over [Model Context Protocol](https://modelcontextprotocol.io/).

## Release Contract

`@smartergpt/lex-mcp` is a coordinated release of Lex core, not a floating
compatibility layer. Each wrapper release pins `@smartergpt/lex` to the same
exact version, reports that version through MCP `serverInfo`, and supports the
same Node range as Lex (`>=20 <25`). Publish the matching Lex release before
publishing this wrapper.

## Quick Start

```bash
npx @smartergpt/lex-mcp
```

## Configuration

### VS Code / Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "lex": {
      "command": "npx",
      "args": ["@smartergpt/lex-mcp"],
      "env": {
        "LEX_WORKSPACE_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lex": {
      "command": "npx",
      "args": ["@smartergpt/lex-mcp"]
    }
  }
}
```

### Quick Smoke Test

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx @smartergpt/lex-mcp
```

## Environment Variables

| Variable             | Description                                  | Default                     |
| -------------------- | -------------------------------------------- | --------------------------- |
| `LEX_WORKSPACE_ROOT` | Project root directory (compat env var name) | Current directory           |
| `LEX_DB_PATH`        | SQLite database path (canonical)             | `.smartergpt/lex/memory.db` |
| `LEX_MEMORY_DB`      | Alias for `LEX_DB_PATH` (compat only)        | —                           |
| `LEX_DEBUG`          | Enable debug logging to stderr               | Off                         |

When both `LEX_DB_PATH` and `LEX_MEMORY_DB` are set, `LEX_DB_PATH` wins.

For multi-root workspaces, set the same absolute `LEX_DB_PATH` for direct Lex, this MCP wrapper, and AXF-routed Lex. The wrapper delegates `.lex.config.json`, environment, and default-store resolution to Lex core, so installed launches now honor caller-project config files. Use `system_introspect` to compare canonical store paths and `path-v1` identities across launch paths.

## Tools

This MCP server provides 14 tools for episodic memory management:

- `frame_create` - Store episodic memory snapshot
- `frame_search` - Search frames by reference, branch, or ticket
- `frame_get` - Retrieve specific frame by ID
- `frame_list` - List recent frames with filtering
- `frame_validate` - Validate frame input (dry-run)
- `policy_check` - Validate code against policy rules
- `timeline_show` - Visual timeline of frame evolution
- `atlas_analyze` - Analyze code structure and dependencies
- `system_introspect` - Discover Lex capabilities and state
- `help` - Usage help and examples
- `hints_get` - Retrieve error recovery hints
- `contradictions_scan` - Detect conflicting information across frames
- `db_stats` - Database statistics and activity metrics
- `turncost_calculate` - Turn Cost governance metrics

## Learn More

See the [Lex documentation](https://github.com/Guffawaffle/lex) for full details.
