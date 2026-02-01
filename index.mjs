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
 *   LEX_WORKSPACE_ROOT - Workspace root directory (default: cwd)
 *   LEX_MEMORY_DB      - SQLite database path (default: .smartergpt/lex/lex.db)
 *   LEX_DEBUG          - Enable debug logging to stderr
 */

import { MCPServer } from "@smartergpt/lex/mcp-server";
import { join } from "path";

// Workspace root defaults to current working directory
const repoRoot = process.env.LEX_WORKSPACE_ROOT || process.cwd();

// Set LEX_WORKSPACE_ROOT for modules that need it
if (!process.env.LEX_WORKSPACE_ROOT) {
  process.env.LEX_WORKSPACE_ROOT = repoRoot;
}

// Database path defaults to .smartergpt/lex/lex.db in workspace root
const dbPath =
  process.env.LEX_MEMORY_DB || join(repoRoot, ".smartergpt", "lex", "lex.db");

// Initialize MCP server
let mcpServer;
try {
  mcpServer = new MCPServer(dbPath, repoRoot);
  if (process.env.LEX_DEBUG) {
    console.error(`[LEX-MCP] Server initialized: ${dbPath}`);
    console.error(`[LEX-MCP] Workspace root: ${repoRoot}`);
  }
} catch (error) {
  console.error(`[LEX-MCP] Failed to initialize: ${error.message}`);
  process.exit(1);
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
      const response = await mcpServer.handleRequest(request);

      // MCP protocol response format
      if (response.error) {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            error: response.error,
          })
        );
      } else {
        console.log(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: response,
          })
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
        })
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
