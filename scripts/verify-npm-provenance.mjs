#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function required(name, pattern) {
  const value = option(name);
  if (!value || (pattern && !pattern.test(value))) {
    throw new Error(`missing or invalid ${name}`);
  }
  return value;
}

function decodePayload(bundle) {
  const encoded = bundle?.bundle?.dsseEnvelope?.payload;
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("verified provenance bundle is missing its DSSE payload");
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

const auditPath = required("--audit");
const name = required("--name", /^@[a-z0-9._-]+\/[a-z0-9._-]+$/u);
const version = required("--version", /^[0-9]+\.[0-9]+\.[0-9]+$/u);
const integrity = required("--integrity", /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
const repository = required(
  "--repository",
  /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const workflow = required("--workflow", /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/u);
const ref = required("--ref", /^refs\/heads\/[A-Za-z0-9._/-]+$/u);
const commit = required("--commit", /^[a-f0-9]{40}$/iu).toLowerCase();
const bundleOutput = option("--bundle-output");

const audit = JSON.parse(readFileSync(auditPath, "utf8"));
if (!Array.isArray(audit.invalid) || audit.invalid.length !== 0) {
  throw new Error("npm signature audit reported invalid package evidence");
}
if (!Array.isArray(audit.missing) || audit.missing.length !== 0) {
  throw new Error("npm signature audit reported missing package evidence");
}

const verified = (audit.verified ?? []).filter(
  (entry) =>
    entry?.name === name &&
    entry?.version === version &&
    entry?.registry === "https://registry.npmjs.org/",
);
if (verified.length !== 1) {
  throw new Error(`npm signature audit must verify exactly one ${name}@${version} entry`);
}

const provenanceBundles = (verified[0].attestationBundles ?? []).filter(
  (bundle) => bundle?.predicateType === "https://slsa.dev/provenance/v1",
);
if (provenanceBundles.length !== 1) {
  throw new Error(`${name}@${version} must have exactly one verified SLSA provenance bundle`);
}

const statement = decodePayload(provenanceBundles[0]);
if (statement.predicateType !== "https://slsa.dev/provenance/v1") {
  throw new Error("verified attestation payload is not SLSA provenance v1");
}

const expectedSubject = `pkg:npm/${name.split("/").map(encodeURIComponent).join("/")}@${version}`;
const expectedDigest = Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex");
const matchingSubjects = (statement.subject ?? []).filter(
  (subject) =>
    subject?.name === expectedSubject && subject?.digest?.sha512?.toLowerCase() === expectedDigest,
);
if (matchingSubjects.length !== 1) {
  throw new Error("verified provenance subject does not match the exact npm package integrity");
}

const predicate = statement.predicate ?? {};
const definition = predicate.buildDefinition ?? {};
const workflowIdentity = definition.externalParameters?.workflow ?? {};
if (
  definition.buildType !== "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1" ||
  workflowIdentity.repository !== repository ||
  workflowIdentity.path !== workflow ||
  workflowIdentity.ref !== ref
) {
  throw new Error("verified provenance does not identify the authorized GitHub workflow source");
}

const sourceUri = `git+${repository}@${ref}`;
const matchingSources = (definition.resolvedDependencies ?? []).filter(
  (dependency) =>
    dependency?.uri === sourceUri && dependency?.digest?.gitCommit?.toLowerCase() === commit,
);
if (matchingSources.length !== 1) {
  throw new Error("verified provenance is not bound to the expected source commit");
}
if (definition.internalParameters?.github?.event_name !== "workflow_dispatch") {
  throw new Error("verified provenance was not produced by the explicit dispatch lane");
}
if (predicate.runDetails?.builder?.id !== "https://github.com/actions/runner/github-hosted") {
  throw new Error("verified provenance was not produced by a GitHub-hosted runner");
}

if (bundleOutput) {
  writeFileSync(bundleOutput, `${JSON.stringify(provenanceBundles[0].bundle)}\n`, "utf8");
}

console.log(JSON.stringify({ package: `${name}@${version}`, integrity, repository, workflow, ref, commit }, null, 2));
