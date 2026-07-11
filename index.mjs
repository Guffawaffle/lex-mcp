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
 * Environment Variables:
 *   LEX_WORKSPACE_ROOT - Project root directory (compat env var name, default: cwd)
 *   LEX_DB_PATH        - SQLite database path (default: .smartergpt/lex/memory.db)
 *   LEX_MEMORY_DB      - Alias for LEX_DB_PATH (for backwards compatibility)
 *   LEX_DEBUG          - Enable debug logging to stderr
 */

import { MCPServer } from "@smartergpt/lex/mcp-server";

// Project root defaults to current working directory.
const projectRoot = process.env.LEX_WORKSPACE_ROOT || process.cwd();

// Set LEX_WORKSPACE_ROOT for modules that need it
if (!process.env.LEX_WORKSPACE_ROOT) {
  process.env.LEX_WORKSPACE_ROOT = projectRoot;
}

// Initialize MCP server
let mcpServer;
try {
  // Lex core owns env, .lex.config.json, and default-path precedence. Passing
  // only the caller root prevents the delivery wrapper from masking config.
  mcpServer = new MCPServer({ repoRoot: projectRoot });
  if (process.env.LEX_DEBUG) {
    console.error(`[LEX-MCP] Project root: ${projectRoot}`);
  }
} catch (error) {
  console.error(`[LEX-MCP] Failed to initialize: ${error.message}`);
  process.exit(1);
}

if (process.env.LEX_DEBUG) {
  console.error(`[LEX-MCP] Ready (stdio mode)`);
}

// MCP stdio protocol handler (JSON-RPC 2.0 over newline-delimited JSON)
process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";

  for (const line of lines) {
    if (!line.trim()) continue;

    let request;
    try {
      request = JSON.parse(line);

      // MCP notifications have no `id` — silently ignore them per spec
      if (request.id === undefined || request.id === null) {
        if (process.env.LEX_DEBUG) {
          console.error(`[LEX-MCP] Notification: ${request.method}`);
        }
        continue;
      }

      const response = await mcpServer.handleRequest(request);

      // MCP protocol response format
      if (response.error) {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: response.error,
          }),
        );
      } else {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: response,
          }),
        );
      }
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request?.id || null,
          error: {
            message: error.message,
            code: error.code || "PARSE_ERROR",
          },
        }),
      );
    }
  }
});

// Graceful shutdown
process.on("SIGINT", () => {
  if (mcpServer) mcpServer.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (mcpServer) mcpServer.close();
  process.exit(0);
});

if (process.env.LEX_DEBUG) {
  console.error("[LEX-MCP] Ready (stdio mode)");
}
