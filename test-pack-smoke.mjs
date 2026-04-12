#!/usr/bin/env node
/**
 * lex-mcp Pack Smoke Test
 *
 * Verifies the published artifact works in a clean install:
 *   1. Pack @smartergpt/lex (local)
 *   2. Pack @smartergpt/lex-mcp (local)
 *   3. Install both tarballs in a clean temp directory
 *   4. Spawn the installed entry point
 *   5. Verify initialize, tools/list, and system_introspect work
 *
 * Usage:
 *   node test-pack-smoke.mjs
 *   node test-pack-smoke.mjs --verbose
 *   node test-pack-smoke.mjs --keep   # keep temp dir for inspection
 */

import { execSync, spawn } from "child_process";
import { mkdtempSync, existsSync, readdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const verbose = process.argv.includes("--verbose");
const keep = process.argv.includes("--keep");

const LEX_ROOT = join(import.meta.dirname, "..", "lex");
const LEX_MCP_ROOT = import.meta.dirname;

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

function log(msg) {
  if (verbose) console.log(`  [info] ${msg}`);
}

/**
 * Send JSON-RPC messages to a server process and collect responses.
 */
async function sendMessages(proc, messages) {
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
        } catch { /* ignore non-JSON lines */ }
      }
    });
    proc.on("close", (code) => {
      if (buffer.trim()) {
        try { responses.push(JSON.parse(buffer)); } catch { /* ignore */ }
      }
      resolve(code);
    });
  });

  let stderr = "";
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (verbose) process.stderr.write(`    [stderr] ${d}`);
  });

  // Wait for server startup
  const earlyExit = await Promise.race([
    new Promise((resolve) => proc.on("close", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);

  if (earlyExit !== null) {
    throw new Error(`Server exited immediately with code ${earlyExit}: ${stderr}`);
  }

  // Send messages
  for (const msg of messages) {
    proc.stdin.write(JSON.stringify(msg) + "\n");
    await new Promise((r) => setTimeout(r, 400));
  }

  // Allow processing
  await new Promise((r) => setTimeout(r, 600));

  proc.kill("SIGTERM");
  await closePromise;
  return responses;
}

async function main() {
  console.log("📦 lex-mcp Pack Smoke Test\n");

  // ── Step 1: Pack both packages ──────────────────────────────────────────

  console.log("📋 Step 1: Packing @smartergpt/lex and @smartergpt/lex-mcp");

  const packDir = mkdtempSync(join(tmpdir(), "lex-pack-smoke-"));
  log(`Temp dir: ${packDir}`);

  let lexTarball, lexMcpTarball;
  try {
    // Pack lex
    log("Packing @smartergpt/lex...");
    const lexPackOut = execSync("npm pack --pack-destination " + JSON.stringify(packDir), {
      cwd: LEX_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    lexTarball = join(packDir, lexPackOut.split("\n").pop().trim());
    assert(existsSync(lexTarball), "lex tarball created", `Expected: ${lexTarball}`);
    log(`lex tarball: ${lexTarball}`);

    // Pack lex-mcp
    log("Packing @smartergpt/lex-mcp...");
    const mcpPackOut = execSync("npm pack --pack-destination " + JSON.stringify(packDir), {
      cwd: LEX_MCP_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    lexMcpTarball = join(packDir, mcpPackOut.split("\n").pop().trim());
    assert(existsSync(lexMcpTarball), "lex-mcp tarball created", `Expected: ${lexMcpTarball}`);
    log(`lex-mcp tarball: ${lexMcpTarball}`);
  } catch (err) {
    console.error(`\n💥 Pack failed: ${err.message}`);
    if (!keep) rmSync(packDir, { recursive: true, force: true });
    process.exit(1);
  }

  // ── Step 2: Clean install ───────────────────────────────────────────────

  console.log("\n📋 Step 2: Clean install from tarballs");

  const installDir = join(packDir, "install");
  try {
    execSync(`mkdir -p ${JSON.stringify(installDir)} && cd ${JSON.stringify(installDir)} && npm init -y`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    log("Installing lex tarball...");
    execSync(`npm install ${JSON.stringify(lexTarball)}`, {
      cwd: installDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });

    log("Installing lex-mcp tarball...");
    execSync(`npm install ${JSON.stringify(lexMcpTarball)}`, {
      cwd: installDir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });

    // Verify node_modules layout
    const mcpBin = join(installDir, "node_modules", ".bin", "lex-mcp");
    const mcpIndex = join(installDir, "node_modules", "@smartergpt", "lex-mcp", "index.mjs");
    const lexPkg = join(installDir, "node_modules", "@smartergpt", "lex", "package.json");

    assert(existsSync(mcpIndex), "lex-mcp index.mjs installed", `${mcpIndex} not found`);
    assert(existsSync(lexPkg), "@smartergpt/lex installed as dependency", `${lexPkg} not found`);

    // Verify lex exports are resolvable
    const lexPkgJson = JSON.parse(readFileSync(lexPkg, "utf-8"));
    assert(lexPkgJson.exports?.["./mcp-server"] != null, "lex exports ./mcp-server subpath", `exports: ${JSON.stringify(Object.keys(lexPkgJson.exports || {}))}`);
  } catch (err) {
    console.error(`\n💥 Install failed: ${err.message}`);
    if (err.stderr) console.error(err.stderr.toString());
    if (!keep) rmSync(packDir, { recursive: true, force: true });
    process.exit(1);
  }

  // ── Step 3: Spawn and test the installed server ─────────────────────────

  console.log("\n📋 Step 3: Verify installed server responds correctly");

  const entryPoint = join(installDir, "node_modules", "@smartergpt", "lex-mcp", "index.mjs");
  const workDir = join(packDir, "workspace");
  execSync(`mkdir -p ${JSON.stringify(workDir)}`);

  try {
    const proc = spawn(process.execPath, [entryPoint], {
      cwd: workDir,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("LEX_"))),
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LEX_WORKSPACE_ROOT: workDir,
        NODE_PATH: join(installDir, "node_modules"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses = await sendMessages(proc, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "pack-test", version: "1.0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "system_introspect", arguments: {} } },
    ]);

    // Verify initialize
    const init = responses.find((r) => r.id === 1);
    assert(init != null, "Got initialize response", "No response");
    assert(init?.result?.serverInfo?.name === "lex-mcp", "serverInfo.name is lex-mcp", `Got: ${init?.result?.serverInfo?.name}`);
    assert(/^\d+\.\d+\.\d+/.test(init?.result?.serverInfo?.version || ""), "serverInfo.version is semver", `Got: ${init?.result?.serverInfo?.version}`);

    // Verify tools/list
    const tools = responses.find((r) => r.id === 2);
    const toolNames = (tools?.result?.tools || []).map((t) => t.name).sort();
    assert(toolNames.length === 14, "14 tools from packed artifact", `Got: ${toolNames.length}`);

    // Verify system_introspect
    const introspect = responses.find((r) => r.id === 3);
    assert(introspect?.result != null, "system_introspect returned result", "No result");

    // Parse the introspect text content to check version
    const content = introspect?.result?.content?.[0]?.text;
    if (content) {
      try {
        const data = JSON.parse(content);
        assert(data.version != null && data.version !== "0.1.0", "introspect version is not stale", `Got: ${data.version}`);
        assert(data.version === init?.result?.serverInfo?.version, "introspect version matches serverInfo", `introspect: ${data.version}, serverInfo: ${init?.result?.serverInfo?.version}`);
      } catch {
        // Human-readable format - extract version with emoji prefix
        const match = content.match(/📦\s*Version:\s*(\d+\.\d+\.\d+\S*)/i);
        if (match) {
          const introVersion = match[1];
          assert(introVersion !== "0.1.0", "introspect version is not stale", `Got: ${introVersion}`);
          assert(introVersion === init?.result?.serverInfo?.version, "introspect version matches serverInfo", `introspect: ${introVersion}, serverInfo: ${init?.result?.serverInfo?.version}`);
        } else {
          log("introspect returned non-JSON content without parseable version, skipping version check");
        }
      }
    }

    // Verify DB was created at the canonical path
    const dbPath = join(workDir, ".smartergpt", "lex", "memory.db");
    // DB may not be created until a write operation, so this is optional
    log(`DB path check: ${dbPath} exists=${existsSync(dbPath)}`);

  } catch (err) {
    console.error(`\n💥 Server test failed: ${err.message}`);
    if (err.stack) log(err.stack);
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"─".repeat(50)}`);

  if (keep) {
    console.log(`\n📁 Temp dir preserved: ${packDir}`);
  } else {
    rmSync(packDir, { recursive: true, force: true });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n💥 Fatal error: ${err.message}`);
  process.exit(1);
});
