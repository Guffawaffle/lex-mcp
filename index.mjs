#!/usr/bin/env node
/**
 * @smartergpt/lex-mcp - MCP Server Entry Point
 *
 * Thin wrapper that starts the Lex MCP server over stdio.
 * This package exists to provide a clean npx launch target for the MCP registry.
 *
 * Usage:
 *   npx @smartergpt/lex-mcp
 *
 * Compatibility-launch environment variables:
 *   LEX_WORKSPACE_ROOT - Project root directory (default: cwd)
 *   LEX_DB_PATH        - SQLite database path (default: .smartergpt/lex/memory.db)
 *   LEX_MEMORY_DB      - Alias for LEX_DB_PATH (for backwards compatibility)
 *   LEX_DEBUG          - Enable debug logging to stderr
 */

import { startLexMcpStdio } from "./stdio.mjs";

// Project root defaults to current working directory.
const projectRoot = process.env.LEX_WORKSPACE_ROOT || process.cwd();

// This executable preserves the local, single-workspace compatibility launch.
// Environment and cwd select local configuration; they never establish trusted
// Lex authority. Trusted hosts import startLexMcpStdio and inject host.mcp.
let transport;
try {
  transport = startLexMcpStdio({
    serverOptions: { repoRoot: projectRoot },
    debug: Boolean(process.env.LEX_DEBUG),
  });
  if (process.env.LEX_DEBUG) {
    console.error(`[LEX-MCP] Project root: ${projectRoot}`);
    console.error("[LEX-MCP] Ready (stdio compatibility mode)");
  }
} catch (error) {
  console.error(`[LEX-MCP] Failed to initialize: ${error.message}`);
  process.exit(1);
}

// Graceful shutdown
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await transport?.close();
    process.exit(0);
  } catch (error) {
    console.error(
      `[LEX-MCP] Failed to shut down: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
