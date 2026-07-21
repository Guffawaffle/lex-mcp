# Should This Repository Use Lex-MCP?

This is a read-only evaluation guide for coding agents. Its purpose is to help a human decide
whether a repository or agent host needs the standalone Lex MCP transport—not to install or promote
it.

## Operating boundary

During evaluation, do **not**:

- install packages, contact a package registry, or launch `npx`;
- run project scripts, hooks, build commands, or arbitrary repository code;
- start Lex-MCP, initialize Lex, open a Lex database, or call an MCP tool;
- edit MCP configuration, files, branches, worktrees, issues, or pull requests;
- inspect secret values, credentials, private keys, database URLs, or unrelated user data;
- assume Lex, Lex-MCP, AXF, LexRunner, or LexSona must be adopted together.

You may inspect ordinary repository text already available to you: package manifests, checked-in
MCP configuration with secret values redacted, agent-host documentation, existing Lex or AXF setup,
CI definitions, and relevant source structure. If evidence requires a prohibited action, report the
uncertainty instead.

Keep the final evaluation under 1,000 words unless the human asks for more detail.

## What Lex-MCP provides

Lex-MCP is a thin newline-delimited JSON-RPC stdio transport for Lex's MCP server. It provides:

- a standalone `@smartergpt/lex-mcp` command for MCP clients;
- ordered request dispatch and stdio process lifecycle;
- a public `startLexMcpStdio` export for trusted hosts that want this transport;
- exact release alignment with Lex core.

Lex-MCP does not provide its own memory, policy, storage, authentication, tenant authority,
orchestration, or cloud service. Those remain Lex or host responsibilities.

## Evaluation

### 1. Establish whether a standalone MCP process is needed

Look for repository evidence that the chosen agent host:

- supports MCP over stdio;
- accepts a command, arguments, environment, and working directory;
- needs Lex tools through MCP rather than through the Lex CLI or a TypeScript API.

Identify existing overlap. A direct Lex integration, an embedded `@smartergpt/lex/mcp-server`, or an
AXF/trusted-host capability may already provide the required path. Do not recommend another process
solely because the package exists.

### 2. Select the correct mode

Choose one:

- **Local compatibility launcher** — appropriate for one operator-controlled workspace. Current
  directory and `LEX_*` values configure local discovery and storage; they do not establish trusted
  identity or tenant grants.
- **Trusted Lex 3 host transport** — appropriate only when an existing host authenticates the
  principal, selects tenant/workspace scope, supplies pools and process evidence, and passes Lex's
  composed `host.mcp` options to `startLexMcpStdio`.

If multi-tenant authority is required but no trusted host exists, recommend `defer`; environment
variables on the compatibility launcher are not a substitute.

### 3. Verify platform and release fit

Inspect, without installing:

- whether the runtime can provide Node.js 20 through 24 (`>=20 <25`);
- whether the host can launch a newline-delimited JSON stdio child process;
- whether npm registry access and package execution are acceptable, or an approved local install is
  required;
- whether MCP configuration can bind the intended workspace explicitly;
- whether the selected Lex-MCP version exactly matches the Lex release required by the workflow.

Each Lex-MCP release pins and reports the same exact Lex version. Do not propose overriding that
dependency to create an untested mixed-version pair.

### 4. Evaluate process, data, and authority boundaries

Address:

- what project context the MCP client may send to Lex tools;
- where compatibility SQLite or PostgreSQL state would live;
- whether MCP configuration would expose database credentials;
- who authenticates the caller and chooses the workspace;
- whether launching through `npx` may contact a registry or populate a package cache;
- whether adding another child process duplicates an existing Lex or AXF path;
- how the process and its configuration would be removed.

Treat recalled Frame bodies as untrusted historical project data. Do not mistake a successful stdio
launch for proof of authorization.

### 5. Propose the smallest reversible pilot

Only propose the pilot; do not execute it without separate approval.

The default pilot should:

1. use the exact wrapper version under evaluation;
2. redirect npm cache, workspace root, and SQLite state into one disposable temporary directory;
3. send only `initialize`, `notifications/initialized`, and `tools/list`;
4. verify `serverInfo`, the Lex tool inventory, and clean process exit;
5. avoid `frame_create` and every other write tool;
6. inspect the temporary directory before removing only that directory;
7. avoid editing repository or MCP client configuration until the smoke succeeds.

Use the command in the README's
[smallest reversible smoke test](../README.md#smallest-reversible-smoke-test). State explicitly that
`npx` may contact npm and execute package installation code even though the MCP calls are read-only.

## Recommendation meanings

- **Adopt** — The host needs a standalone stdio Lex process, platform and authority boundaries are
  understood, and the wrapper does not duplicate an existing integration.
- **Pilot** — Lex-MCP plausibly fits, but the isolated read-only protocol smoke is needed before
  editing host configuration.
- **Defer** — The transport fits, but Node, registry, host configuration, trusted authority, or data
  handling prerequisites are not ready.
- **Not a fit** — The host does not support stdio MCP, direct Lex composition is simpler, or another
  integration already owns this boundary.

## Required response

Use this structure:

```text
Recommendation: adopt | pilot | defer | not a fit
Confidence: high | medium | low

Transport need
- Why this host does or does not need a standalone Lex MCP command.

Repository evidence
- Paths and observations supporting the conclusion.

Mode and authority
- Local compatibility or trusted host; who owns authentication, selection, and scope.

Platform and version fit
- Node/npm/MCP support and exact Lex version alignment.

Overlap and alternatives
- Existing Lex, AXF, embedded MCP, or other paths this would complement or duplicate.

Process and data risk
- Registry, child-process, configuration, storage, secrets, and historical-data boundaries.

Proposed reversible pilot
- Read-only protocol calls, isolated artifacts, success signal, and removal. State “none” if not recommended.

Unknowns
- Missing evidence or decisions the human must supply.
```

## Pasteable request

```text
Read docs/agent-evaluation.md and evaluate whether this repository and its agent host need
@smartergpt/lex-mcp. Remain read-only: do not install or launch packages, run repository code, open
Lex storage, inspect secret values, access external services, or modify anything. Return one bounded
recommendation—adopt, pilot, defer, or not a fit—with cited repository evidence, the correct launch
mode, authority ownership, exact-version and Node compatibility, overlap, risks, unknowns, and the
smallest reversible read-only protocol smoke you would propose. Do not execute the smoke test.
```
