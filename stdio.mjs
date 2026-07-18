/**
 * Newline-delimited JSON-RPC transport for Lex's MCP server.
 *
 * This module deliberately owns transport only. Canonical authority, workspace
 * selection, and scope-bound stores must be composed by the trusted host and
 * passed through `serverOptions`; they are never reconstructed from ambient
 * process state here.
 */

import { MCPServer } from "@smartergpt/lex/mcp-server";

/** @typedef {import("@smartergpt/lex/mcp-server").MCPServerOptions} MCPServerOptions */

const JSON_RPC_PARSE_ERROR = -32700;
const JSON_RPC_INVALID_REQUEST = -32600;
const JSON_RPC_APPLICATION_ERROR = -32000;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function applicationError(error) {
  const record = isRecord(error) ? error : {};
  const sourceCode = record.code;
  const code = Number.isInteger(sourceCode)
    ? sourceCode
    : JSON_RPC_APPLICATION_ERROR;
  const message =
    typeof record.message === "string" ? record.message : errorMessage(error);

  const data = isRecord(record.data)
    ? { ...record.data }
    : record.data === undefined
      ? {}
      : { details: record.data };
  if (typeof sourceCode === "string") {
    data.lexCode = sourceCode;
  }
  for (const field of ["context", "nextActions", "metadata"]) {
    if (record[field] !== undefined) data[field] = record[field];
  }

  return {
    code,
    message,
    ...(Object.keys(data).length === 0 ? {} : { data }),
  };
}

function isValidRequestEnvelope(request) {
  return (
    isRecord(request) &&
    request.jsonrpc === "2.0" &&
    typeof request.method === "string" &&
    request.method.length > 0
  );
}

function isValidRequestId(id) {
  return (
    typeof id === "string" || (typeof id === "number" && Number.isFinite(id))
  );
}

/**
 * Start a Lex MCP server on newline-delimited JSON stdio.
 *
 * Trusted Lex 3 hosts pass the unmodified `host.mcp` object returned by
 * `createPostgresTrustedRuntimeHost`. The optional `serverFactory` is intended
 * for embedding and transport tests; it receives the same options object by
 * identity.
 *
 * @param {object} options
 * @param {MCPServerOptions} options.serverOptions
 * @param {NodeJS.ReadableStream} [options.input]
 * @param {NodeJS.WritableStream} [options.output]
 * @param {NodeJS.WritableStream} [options.errorOutput]
 * @param {boolean} [options.debug]
 * @param {(serverOptions: MCPServerOptions) => Pick<MCPServer, "handleRequest" | "close">} [options.serverFactory]
 */
export function startLexMcpStdio({
  serverOptions,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  debug = false,
  serverFactory = (options) => new MCPServer(options),
}) {
  if (!serverOptions || typeof serverOptions !== "object") {
    throw new TypeError(
      "serverOptions must be an explicit MCPServerOptions object",
    );
  }

  const mcpServer = serverFactory(serverOptions);
  if (
    !mcpServer ||
    typeof mcpServer.handleRequest !== "function" ||
    typeof mcpServer.close !== "function"
  ) {
    throw new TypeError(
      "serverFactory must return an MCPServer-compatible server",
    );
  }

  input.setEncoding?.("utf8");
  let buffer = "";
  let work = Promise.resolve();
  let closePromise;

  const writeResponse = (response) => {
    output.write(`${JSON.stringify(response)}\n`);
  };

  const handleLine = async (line) => {
    if (!line.trim()) return;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_PARSE_ERROR, message: "Parse error" },
      });
      return;
    }

    if (!isValidRequestEnvelope(request)) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid Request" },
      });
      return;
    }

    // Only an absent id denotes a notification. JSON-RPC permits clients to
    // send null, but Lex 3 treats it as invalid so request/response ownership
    // remains unambiguous.
    if (!Object.hasOwn(request, "id")) {
      if (debug) {
        errorOutput.write(`[LEX-MCP] Notification: ${request.method}\n`);
      }
      try {
        // Notifications participate in the same serialized dispatch stream as
        // requests, but JSON-RPC forbids returning either a result or an error
        // response for them.
        await mcpServer.handleRequest(request);
      } catch (error) {
        errorOutput.write(
          `[LEX-MCP] Notification failed (${request.method}): ${errorMessage(error)}\n`,
        );
      }
      return;
    }

    if (!isValidRequestId(request.id)) {
      writeResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: JSON_RPC_INVALID_REQUEST, message: "Invalid Request" },
      });
      return;
    }

    try {
      const response = await mcpServer.handleRequest(request);
      if (!isRecord(response)) {
        throw new TypeError("Lex returned an invalid MCP response");
      }
      writeResponse(
        response.error
          ? {
              jsonrpc: "2.0",
              id: request.id,
              error: applicationError(response.error),
            }
          : { jsonrpc: "2.0", id: request.id, result: response },
      );
    } catch (error) {
      writeResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: applicationError(error),
      });
    }
  };

  const enqueueLine = (line) => {
    work = work.then(() => handleLine(line));
  };

  const flushBuffer = () => {
    if (!buffer.trim()) {
      buffer = "";
      return;
    }
    const line = buffer;
    buffer = "";
    enqueueLine(line);
  };

  const onData = (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    // Serialize requests in wire order. This avoids interleaving responses or
    // request-local scope stores when multiple lines arrive in one chunk.
    for (const line of lines) {
      enqueueLine(line);
    }
  };

  const close = () => {
    if (closePromise) return closePromise;

    input.off?.("data", onData);
    input.off?.("end", onEnd);
    flushBuffer();
    closePromise = (async () => {
      try {
        await work;
      } finally {
        await mcpServer.close();
      }
    })();
    return closePromise;
  };

  // EOF is the transport lifecycle boundary: accept a final record without a
  // newline, drain every queued request, then close the Lex server exactly once.
  const onEnd = () => {
    void close().catch((error) => {
      errorOutput.write(`[LEX-MCP] Failed to close: ${errorMessage(error)}\n`);
    });
  };

  input.on("data", onData);
  input.on("end", onEnd);

  return Object.freeze({
    server: mcpServer,
    idle: () => closePromise ?? work,
    close,
  });
}
