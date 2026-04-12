#!/usr/bin/env node
/**
 * lex-mcp Delivery Contract Tests
 *
 * Black-box tests that verify the canonical contract:
 *   - Default DB path: .smartergpt/lex/memory.db
 *   - Canonical env var: LEX_DB_PATH
 *   - Compat alias: LEX_MEMORY_DB
 *   - Canonical launch: node index.mjs (simulates npx @smartergpt/lex-mcp)
 *   - serverInfo returns correct name and version
 *   - Tool list returns exactly 14 canonical tools
 *
 * Usage:
 *   node test-contract.mjs
 *   node test-contract.mjs --verbose
 */

import { spawn } from "child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const verbose = process.argv.includes("--verbose");
const INDEX_PATH = join(import.meta.dirname, "index.mjs");

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}: ${detail}`);
    failed++;
  }
}

/**
 * Send a single JSON-RPC request to a fresh server instance and return the response.
 * Server is spawned with the given env, sends the request, collects the response, then kills.
 */
async function sendRequest(env, messages) {
  const workDir = env._workDir || env.LEX_WORKSPACE_ROOT || process.cwd();
  const proc = spawn(process.execPath, [INDEX_PATH], {
    cwd: workDir,
    env: { ...process.env, ...env, LEX_DEBUG: verbose ? "1" : "" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (verbose) process.stderr.write(`    [stderr] ${d}`);
  });

  const responses = [];
  let buffer = "";

  const closePromise = new Promise((resolve) => {
    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch { /* ignore */ }
      }
    });
    proc.on("close", (code) => {
      if (buffer.trim()) {
        try { responses.push(JSON.parse(buffer)); } catch { /* ignore */ }
      }
      resolve(code);
    });
  });

  // Wait for server startup
  const earlyExit = await Promise.race([
    new Promise((resolve) => proc.on("close", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

  if (earlyExit !== null) {
    throw new Error(`Server exited immediately with code ${earlyExit}: ${stderr}`);
  }

  // Send messages
  for (const msg of messages) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
    await new Promise((r) => setTimeout(r, 300));
  }

  // Allow processing
  await new Promise((r) => setTimeout(r, 500));

  proc.kill("SIGTERM");
  await closePromise;

  return responses;
}

// ── Test 1: Default DB path ─────────────────────────────────────────────────

async function testDefaultDbPath() {
  console.log("\n📋 Test: Default DB path is .smartergpt/lex/memory.db");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-dbpath-"));
  try {
    // Send initialize + create a frame so the DB is actually written
    await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frame_create", arguments: { reference_point: "contract test", summary_caption: "testing default path", status_snapshot: { next_action: "verify" }, module_scope: ["test"] } } },
      ]
    );

    const expectedDir = join(workDir, ".smartergpt", "lex");
    const expectedDb = join(expectedDir, "memory.db");

    assert(existsSync(expectedDb), "DB created at .smartergpt/lex/memory.db", `${expectedDb} does not exist`);

    // Verify no lex.db or lex-memory.db was created
    const files = existsSync(expectedDir) ? readdirSync(expectedDir) : [];
    assert(!files.includes("lex.db"), "No lex.db created (old default)", `Found lex.db in ${expectedDir}`);
    assert(!files.includes("lex-memory.db"), "No lex-memory.db created (older default)", `Found lex-memory.db in ${expectedDir}`);

    // Verify no DB at workspace root
    const rootFiles = readdirSync(workDir);
    assert(!rootFiles.includes("lex-memory.db"), "No lex-memory.db at workspace root", "Found lex-memory.db at root");
    assert(!rootFiles.includes("lex.db"), "No lex.db at workspace root", "Found lex.db at root");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 2: LEX_DB_PATH override ────────────────────────────────────────────

async function testLexDbPathOverride() {
  console.log("\n📋 Test: LEX_DB_PATH overrides default");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-dbpath-override-"));
  const customDb = join(workDir, "custom", "my.db");
  try {
    await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, LEX_DB_PATH: customDb, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frame_create", arguments: { reference_point: "db path test", summary_caption: "LEX_DB_PATH override", status_snapshot: { next_action: "verify" }, module_scope: ["test"] } } },
      ]
    );

    assert(existsSync(customDb), "DB created at LEX_DB_PATH location", `${customDb} does not exist`);

    // Default location should NOT be created
    const defaultDb = join(workDir, ".smartergpt", "lex", "memory.db");
    assert(!existsSync(defaultDb), "Default DB NOT created when LEX_DB_PATH set", `${defaultDb} unexpectedly exists`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 3: LEX_MEMORY_DB compat alias ──────────────────────────────────────

async function testLexMemoryDbCompat() {
  console.log("\n📋 Test: LEX_MEMORY_DB works as compat alias");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-memdb-"));
  const compatDb = join(workDir, "compat", "legacy.db");
  try {
    await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, LEX_MEMORY_DB: compatDb, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frame_create", arguments: { reference_point: "compat test", summary_caption: "LEX_MEMORY_DB compat", status_snapshot: { next_action: "verify" }, module_scope: ["test"] } } },
      ]
    );

    assert(existsSync(compatDb), "DB created at LEX_MEMORY_DB location", `${compatDb} does not exist`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 4: LEX_DB_PATH takes priority over LEX_MEMORY_DB ──────────────────

async function testDbPathPrecedence() {
  console.log("\n📋 Test: LEX_DB_PATH takes priority over LEX_MEMORY_DB");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-precedence-"));
  const canonicalDb = join(workDir, "canonical", "winner.db");
  const compatDb = join(workDir, "compat", "loser.db");
  try {
    await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, LEX_DB_PATH: canonicalDb, LEX_MEMORY_DB: compatDb, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "frame_create", arguments: { reference_point: "precedence test", summary_caption: "canonical wins", status_snapshot: { next_action: "verify" }, module_scope: ["test"] } } },
      ]
    );

    assert(existsSync(canonicalDb), "DB created at LEX_DB_PATH (canonical wins)", `${canonicalDb} does not exist`);
    assert(!existsSync(compatDb), "DB NOT created at LEX_MEMORY_DB (compat loses)", `${compatDb} unexpectedly exists`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 5: serverInfo ──────────────────────────────────────────────────────

async function testServerInfo() {
  console.log("\n📋 Test: serverInfo returns correct name and non-stale version");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-info-"));
  try {
    const responses = await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
      ]
    );

    const init = responses.find((r) => r.id === 1);
    assert(init != null, "Got initialize response", "No response");

    const info = init?.result?.serverInfo;
    assert(info?.name === "lex-mcp", `serverInfo.name is "lex-mcp"`, `Got: ${info?.name}`);
    assert(info?.version !== "0.1.0", "serverInfo.version is not stale 0.1.0", `Got: ${info?.version}`);
    assert(/^\d+\.\d+\.\d+/.test(info?.version || ""), "serverInfo.version is semver", `Got: ${info?.version}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 6: tool list ───────────────────────────────────────────────────────

async function testToolList() {
  console.log("\n📋 Test: tools/list returns exactly 14 canonical tools");

  const CANONICAL_TOOLS = [
    "atlas_analyze",
    "contradictions_scan",
    "db_stats",
    "frame_create",
    "frame_get",
    "frame_list",
    "frame_search",
    "frame_validate",
    "help",
    "hints_get",
    "policy_check",
    "system_introspect",
    "timeline_show",
    "turncost_calculate",
  ];

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-tools-"));
  try {
    const responses = await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      ]
    );

    const toolsResp = responses.find((r) => r.id === 2);
    assert(toolsResp != null, "Got tools/list response", "No response");

    const tools = toolsResp?.result?.tools || [];
    const names = tools.map((t) => t.name).sort();

    assert(tools.length === 14, `Tool count is 14`, `Got: ${tools.length}`);
    assert(
      JSON.stringify(names) === JSON.stringify(CANONICAL_TOOLS),
      "Tool names match canonical list",
      `Got: ${JSON.stringify(names)}`
    );

    // Verify no legacy-named tools leak into the list
    const legacyNames = ["remember", "recall", "introspect", "timeline", "code_atlas", "get_frame", "list_frames"];
    const leaked = names.filter((n) => legacyNames.includes(n));
    assert(leaked.length === 0, "No legacy tool names in list", `Found: ${leaked.join(", ")}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 7: system_introspect version matches serverInfo ────────────────────

async function testIntrospectVersion() {
  console.log("\n📋 Test: system_introspect version matches serverInfo (not cwd-dependent)");

  // Use a temp dir far from lex source to prove version isn't read from cwd
  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-introspect-"));
  try {
    const responses = await sendRequest(
      { LEX_WORKSPACE_ROOT: workDir, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "system_introspect", arguments: {} } },
      ]
    );

    const init = responses.find((r) => r.id === 1);
    const serverVersion = init?.result?.serverInfo?.version;

    const introspect = responses.find((r) => r.id === 2);
    const content = introspect?.result?.content?.[0]?.text;
    assert(content != null, "system_introspect returned content", "No content");

    let introVersion = null;
    try {
      const data = JSON.parse(content);
      introVersion = data.version;
    } catch {
      // Human-readable format: match "📦 Version: X.Y.Z" (not "Schema Version")
      const match = content?.match(/📦\s*Version:\s*(\d+\.\d+\.\d+\S*)/i)
        || content?.match(/^Version:\s*(\d+\.\d+\.\d+\S*)/im);
      if (match) introVersion = match[1];
    }

    assert(introVersion != null, "introspect contains version", `Content: ${content?.slice(0, 100)}`);
    assert(introVersion !== "0.1.0", "introspect version is not stale 0.1.0", `Got: ${introVersion}`);
    assert(introVersion === serverVersion, "introspect version matches serverInfo.version", `introspect=${introVersion}, serverInfo=${serverVersion}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Test 8: startup with no env vars ────────────────────────────────────────

async function testBareStartup() {
  console.log("\n📋 Test: Server starts with zero env vars (uses cwd as workspace)");

  const workDir = mkdtempSync(join(tmpdir(), "lex-contract-bare-"));
  try {
    // Strip all LEX_ env vars to simulate bare npx launch
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("LEX_"))
    );
    cleanEnv.PATH = process.env.PATH;
    cleanEnv.HOME = process.env.HOME;

    const responses = await sendRequest(
      { ...cleanEnv, _workDir: workDir },
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } } },
      ]
    );

    const init = responses.find((r) => r.id === 1);
    assert(init?.result?.protocolVersion != null, "Server started and responded to initialize", "No valid response");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

// ── Run all ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔒 lex-mcp Delivery Contract Tests\n");

  await testDefaultDbPath();
  await testLexDbPathOverride();
  await testLexMemoryDbCompat();
  await testDbPathPrecedence();
  await testServerInfo();
  await testToolList();
  await testIntrospectVersion();
  await testBareStartup();

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(50)}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n💥 Fatal error: ${err.message}`);
  process.exit(1);
});
