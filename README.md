# @smartergpt/lex-mcp

Thin MCP stdio wrapper for [@smartergpt/lex](https://github.com/Guffawaffle/lex) episodic memory.

Lex owns all capabilities and authority decisions. This package owns delivery
over [Model Context Protocol](https://modelcontextprotocol.io/).

## Release Contract

`@smartergpt/lex-mcp` is a coordinated release of Lex core, not a floating
compatibility layer. Each wrapper release pins `@smartergpt/lex` to the same
exact version, reports that version through MCP `serverInfo`, and supports the
same Node range as Lex (`>=20 <25`). Publish the matching Lex release before
publishing this wrapper.

Prepublication CI applies the staged wrapper version only to its disposable Lex
checkout, then builds, installs, and packs that local source. After Lex is
published, refresh this repository's registry lock with
`npm install --package-lock-only --ignore-scripts`, verify no `file:` dependency
was introduced, commit the resulting integrity, and only then tag or publish
Lex MCP. The release workflow enforces that post-publish integrity gate.

## Local Compatibility Launch

```bash
npx @smartergpt/lex-mcp
```

The executable is the backwards-compatible, local single-workspace launch. It
uses the current directory or `LEX_WORKSPACE_ROOT` for project discovery and
delegates local store configuration to Lex. Those values configure the local
process; they do not establish canonical authority, grants, or a tenant scope.

## Trusted Lex 3 Host

Multi-tenant and cross-workspace hosts compose authority explicitly with Lex,
then pass Lex's MCP options through this package unchanged:

```js
import { startLexMcpStdio } from "@smartergpt/lex-mcp";
import { createPostgresTrustedRuntimeHost } from "@smartergpt/lex/runtime-scope";

const host = createPostgresTrustedRuntimeHost({
  authorityPool, // read-only runtime authority connection
  selection, // authenticated tenant/workspace selection owned by this host
  frameStoreBinder, // scope-bound PostgreSQL frame store binder
  process: capturedProcessEvidence,
  runtimeId,
  traceId,
  emitDiagnostics,
});

const transport = startLexMcpStdio({ serverOptions: host.mcp });
```

The host must supply its pools, authenticated selection, process evidence, and
IDs. Neither Lex nor this wrapper reconstructs trusted authority from
environment variables. See Lex's runtime-scope documentation for the complete
host composition and PostgreSQL RLS contracts.

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

## Compatibility-Launcher Environment Variables

| Variable                | Description                                       | Default                     |
| ----------------------- | ------------------------------------------------- | --------------------------- |
| `LEX_WORKSPACE_ROOT`    | Local project root                                | Current directory           |
| `LEX_STORE`             | Compatibility frame backend (`sqlite`/`postgres`) | `sqlite`                    |
| `LEX_DATABASE_URL`      | Compatibility PostgreSQL connection URL           | —                           |
| `LEX_POSTGRES_PASSWORD` | Password for a credential-free compatibility URL  | —                           |
| `LEX_POSTGRES_POOL_MAX` | Compatibility PostgreSQL pool size                | `10`                        |
| `LEX_DB_PATH`           | SQLite database path; ignored by PostgreSQL       | `.smartergpt/lex/memory.db` |
| `LEX_MEMORY_DB`         | Alias for `LEX_DB_PATH` (compat only)             | —                           |
| `LEX_DEBUG`             | Enable debug logging to stderr                    | Off                         |

When both `LEX_DB_PATH` and `LEX_MEMORY_DB` are set, `LEX_DB_PATH` wins.

For multi-root compatibility launches using SQLite, set the same absolute
`LEX_DB_PATH` for direct Lex, this MCP wrapper, and AXF-routed Lex. The wrapper
delegates `.lex.config.json`, environment, and local store resolution to Lex
core, so installed launches honor caller-project config files. Shared trusted
PostgreSQL deployments must instead inject canonical authority and a scoped
store binder as shown above; environment configuration alone is never a trusted
multi-tenant bootstrap.

## Agent Output

Agents can request `format: "compact"` on supported frame and introspection
tools to avoid redundant presentation metadata. Runtime-scope diagnostics are
absent by default and appear only when a caller explicitly requests
`diagnostics: "summary"` or `"full"` and has the required authority. Output
format and diagnostics affect presentation only; they never change scope or
authorization outcomes.

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
