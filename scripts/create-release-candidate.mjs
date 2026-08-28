#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function digest(bytes, algorithm, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function packageContract() {
  const pkg = readJson(resolve("package.json"));
  const lock = readJson(resolve("package-lock.json"));
  const lexVersion = pkg.dependencies?.["@smartergpt/lex"];
  const lockedLex = lock.packages?.["node_modules/@smartergpt/lex"];
  const expectedResolved = `https://registry.npmjs.org/@smartergpt/lex/-/lex-${pkg.version}.tgz`;

  if (pkg.version !== lexVersion) {
    fail(`wrapper ${pkg.version} does not exactly match Lex ${lexVersion}`);
  }
  if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
    fail("lockfile root does not match the wrapper version");
  }
  if (lockedLex?.version !== pkg.version || lockedLex?.resolved !== expectedResolved) {
    fail("lockfile does not resolve the exact public Lex release");
  }
  if (typeof lockedLex.integrity !== "string" || !lockedLex.integrity.startsWith("sha512-")) {
    fail("locked Lex integrity is missing");
  }

  return {
    package: { name: pkg.name, version: pkg.version },
    lex: {
      name: "@smartergpt/lex",
      version: lockedLex.version,
      resolved: lockedLex.resolved,
      integrity: lockedLex.integrity,
    },
  };
}

function artifact(path) {
  const absolute = resolve(path);
  const bytes = readFileSync(absolute);
  return {
    filename: basename(absolute),
    size: bytes.length,
    shasum: digest(bytes, "sha1"),
    sha256: digest(bytes, "sha256"),
    integrity: `sha512-${digest(bytes, "sha512", "base64")}`,
  };
}

function create(tarballPath, commit, outputPath) {
  if (!/^[0-9a-f]{40}$/.test(commit)) fail(`invalid source commit: ${commit}`);
  const receipt = {
    schemaVersion: "lex-mcp-release-candidate-v1",
    artifactStatus: "verified",
    ...packageContract(),
    source: { commit },
    artifact: artifact(tarballPath),
    createdAt: new Date().toISOString(),
  };
  writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(receipt));
}

function verify(receiptPath, tarballPath, expectedCommit) {
  const receipt = readJson(resolve(receiptPath));
  const contract = packageContract();
  const actualArtifact = artifact(tarballPath);
  if (receipt.schemaVersion !== "lex-mcp-release-candidate-v1") fail("unknown receipt schema");
  if (receipt.artifactStatus !== "verified") fail("candidate is not verified");
  if (receipt.source?.commit !== expectedCommit) fail("receipt commit does not match the workflow commit");
  if (JSON.stringify(receipt.package) !== JSON.stringify(contract.package)) fail("receipt package does not match source");
  if (JSON.stringify(receipt.lex) !== JSON.stringify(contract.lex)) fail("receipt Lex lock does not match source");
  if (JSON.stringify(receipt.artifact) !== JSON.stringify(actualArtifact)) fail("candidate bytes do not match receipt");
  console.log(`Verified ${receipt.package.name}@${receipt.package.version} from ${expectedCommit}`);
}

const [mode, first, second, third] = process.argv.slice(2);
if (mode === "create" && first && second && third) {
  create(first, second, third);
} else if (mode === "verify" && first && second && third) {
  verify(first, second, third);
} else {
  fail("usage: create-release-candidate.mjs create <tarball> <commit> <receipt> | verify <receipt> <tarball> <commit>");
}
