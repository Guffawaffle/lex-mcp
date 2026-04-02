# @smartergpt/lex-mcp

MCP server wrapper for [Lex](https://github.com/Guffawaffle/lex) episodic memory.

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LEX_WORKSPACE_ROOT` | Workspace root directory | Current directory |
| `LEX_MEMORY_DB` | SQLite database path | `.smartergpt/lex/lex.db` |
| `LEX_DEBUG` | Enable debug logging | Off |

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
