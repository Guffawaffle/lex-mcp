#!/usr/bin/env node
/**
 * MCP Server Test Harness
 *
 * Simulates what VS Code / Claude Desktop MCP clients send.
 * Spawns the server as a subprocess, runs the full protocol handshake,
 * and validates responses.
 *
 * Usage:
 *   node test-mcp-server.mjs                    # Test published (npm) version
 *   node test-mcp-server.mjs --local             # Test local ./index.mjs
 *   node test-mcp-server.mjs --installed <path>  # Test specific binary path
 *
 * Options:
 *   --clean    Use a fresh temp directory (simulates new user)
 *   --verbose  Show full JSON responses
 */

import { spawn } from "child_process";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const args = process.argv.slice(2);
const isLocal = args.includes("--local");
const isClean = args.includes("--clean");
const verbose = args.includes("--verbose");
const installedIdx = args.indexOf("--installed");
const installedPath = installedIdx !== -1 ? args[installedIdx + 1] : null;

// --- Setup workspace ---
let workDir;
if (isClean) {
  workDir = mkdtempSync(join(tmpdir(), "lex-mcp-test-"));
  console.log(`📁 Clean workspace: ${workDir}`);
} else {
  workDir = process.cwd();
  console.log(`📁 Using cwd: ${workDir}`);
}

// --- Determine what to spawn ---
let cmd, cmdArgs;
if (isLocal) {
  cmd = process.execPath;
  cmdArgs = [join(import.meta.dirname, "index.mjs")];
  console.log(`🔧 Testing LOCAL: node index.mjs`);
} else if (installedPath) {
  cmd = process.execPath;
  cmdArgs = [installedPath];
  console.log(`🔧 Testing: node ${installedPath}`);
} else {
  cmd = "npx";
  cmdArgs = ["@smartergpt/lex-mcp"];
  console.log(`🔧 Testing PUBLISHED: npx @smartergpt/lex-mcp`);
}

// --- MCP Protocol Messages (mimics VS Code / Claude Desktop) ---
const PROTOCOL_SEQUENCE = [
  {
    label: "initialize",
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "lex-mcp-test-harness", version: "1.0.0" },
      },
    },
    expectResponse: true,
    validate: (resp) => {
      if (!resp.result?.protocolVersion) return "Missing protocolVersion";
      if (!resp.result?.capabilities?.tools) return "Missing tools capability";
      if (!resp.result?.serverInfo?.name) return "Missing serverInfo.name";
      return null;
    },
  },
  {
    label: "notifications/initialized",
    message: {
      jsonrpc: "2.0",
      method: "notifications/initialized",
      // NOTE: No `id` — this is a notification, not a request
    },
    expectResponse: false, // MCP notifications MUST NOT get a response
  },
  {
    label: "tools/list",
    message: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    },
    expectResponse: true,
    validate: (resp) => {
      if (!resp.result?.tools) return "Missing tools array";
      if (!Array.isArray(resp.result.tools)) return "tools is not an array";
      if (resp.result.tools.length === 0) return "No tools registered";
      // Check essential tools exist
      const names = resp.result.tools.map((t) => t.name);
      const required = ["frame_create", "frame_search", "system_introspect"];
      for (const req of required) {
        if (!names.includes(req)) return `Missing required tool: ${req}`;
      }
      return null;
    },
  },
  {
    label: "tools/call (system_introspect)",
    message: {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "system_introspect",
        arguments: { format: "compact" },
      },
    },
    expectResponse: true,
    validate: (resp) => {
      if (resp.error) return `Tool error: ${resp.error.message}`;
      if (!resp.result) return "No result";
      return null;
    },
  },
  {
    label: "tools/call (frame_create)",
    message: {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "frame_create",
        arguments: {
          reference_point: "test harness validation",
          summary_caption: "Verifying MCP server works end-to-end",
          status_snapshot: { next_action: "continue testing" },
          module_scope: ["test"],
        },
      },
    },
    expectResponse: true,
    validate: (resp) => {
      if (resp.error) return `Tool error: ${resp.error.message}`;
      if (!resp.result) return "No result";
      return null;
    },
  },
  {
    label: "tools/call (frame_search)",
    message: {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "frame_search",
        arguments: {
          reference_point: "test harness",
          limit: 1,
        },
      },
    },
    expectResponse: true,
    validate: (resp) => {
      if (resp.error) return `Tool error: ${resp.error.message}`;
      return null;
    },
  },
  {
    label: "notifications/cancelled (should be ignored)",
    message: {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 999, reason: "test" },
    },
    expectResponse: false,
  },
];

// --- Run test ---
const results = [];
let passed = 0;
let failed = 0;
let warnings = 0;

function log(icon, label, msg) {
  console.log(`  ${icon} ${label}: ${msg}`);
}

async function runTests() {
  const proc = spawn(cmd, cmdArgs, {
    cwd: workDir,
    env: {
      ...process.env,
      LEX_WORKSPACE_ROOT: workDir,
      LEX_DEBUG: verbose ? "1" : "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (verbose) process.stderr.write(`  [server stderr] ${d}`);
  });

  // Collect responses
  const responses = [];
  let buffer = "";

  const responsePromise = new Promise((resolve) => {
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          console.error(
            `  ⚠️  Unparseable server output: ${line.slice(0, 100)}`,
          );
        }
      }
    });

    proc.on("close", (code) => {
      // Parse any remaining buffered data
      if (buffer.trim()) {
        try {
          responses.push(JSON.parse(buffer));
        } catch {
          /* ignore */
        }
      }
      resolve(code);
    });
  });

  // Check if server exits immediately (startup failure)
  const earlyExit = await Promise.race([
    new Promise((resolve) => proc.on("close", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

  if (earlyExit !== null) {
    console.log(`\n❌ Server exited immediately with code ${earlyExit}`);
    if (stderr) console.log(`  stderr: ${stderr.trim()}`);
    process.exit(1);
  }

  // Send messages with delays to allow processing
  console.log(`\n🧪 Running ${PROTOCOL_SEQUENCE.length} protocol tests...\n`);

  for (const step of PROTOCOL_SEQUENCE) {
    const prevCount = responses.length;
    proc.stdin.write(JSON.stringify(step.message) + "\n");
    // Give server time to process
    await new Promise((r) => setTimeout(r, 500));
  }

  // Wait a bit more for all responses
  await new Promise((r) => setTimeout(r, 1000));

  // Kill server
  proc.kill("SIGTERM");
  await responsePromise;

  // --- Analyze responses ---
  console.log(`📊 Received ${responses.length} responses\n`);

  // Map responses by id
  const byId = {};
  const noId = [];
  for (const r of responses) {
    if (r.id != null) {
      byId[r.id] = r;
    } else {
      noId.push(r);
    }
  }

  for (const step of PROTOCOL_SEQUENCE) {
    if (step.expectResponse) {
      const resp = byId[step.message.id];
      if (!resp) {
        log("❌", step.label, "No response received");
        failed++;
        continue;
      }

      if (verbose) {
        console.log(
          `  📋 ${step.label} response:\n${JSON.stringify(resp, null, 2).slice(0, 500)}\n`,
        );
      }

      if (step.validate) {
        const err = step.validate(resp);
        if (err) {
          log("❌", step.label, err);
          failed++;
        } else {
          log("✅", step.label, "OK");
          passed++;
        }
      } else {
        log("✅", step.label, "Response received");
        passed++;
      }
    } else {
      // Notification — should NOT get a response
      // Check if any response without an id appeared (bad sign)
      const spuriousErrors = noId.filter((r) =>
        r.error?.message?.includes(step.message.method),
      );
      if (spuriousErrors.length > 0) {
        log(
          "❌",
          step.label,
          `Server sent error response to notification: ${spuriousErrors[0].error.message}`,
        );
        failed++;
      } else {
        log("✅", step.label, "Correctly ignored (no response)");
        passed++;
      }
    }
  }

  // Summary
  console.log(`\n${"─".repeat(50)}`);
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${warnings} warnings`,
  );
  console.log(`${"─".repeat(50)}`);

  if (stderr && !verbose) {
    const importantStderr = stderr
      .split("\n")
      .filter(
        (l) => l.includes("Error") || l.includes("error") || l.includes("WARN"),
      );
    if (importantStderr.length > 0) {
      console.log(`\n⚠️  Server errors:`);
      importantStderr.forEach((l) => console.log(`  ${l}`));
    }
  }

  // Cleanup temp dir
  if (isClean) {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(`\n💥 Test harness error: ${err.message}`);
  process.exit(1);
});
