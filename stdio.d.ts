import type { Readable, Writable } from "node:stream";
import type { MCPServer, MCPServerOptions } from "@smartergpt/lex/mcp-server";

export type LexMcpRequestServer = Pick<MCPServer, "handleRequest" | "close">;

export interface LexMcpStdioOptions {
  /** Explicit Lex configuration, including a trusted host's unmodified `host.mcp`. */
  serverOptions: MCPServerOptions;
  input?: Readable;
  output?: Writable;
  errorOutput?: Writable;
  debug?: boolean;
  /** Optional embedding/test seam. Receives `serverOptions` by identity. */
  serverFactory?: (serverOptions: MCPServerOptions) => LexMcpRequestServer;
}

export interface LexMcpStdioTransport {
  readonly server: LexMcpRequestServer;
  /** Resolve once received records are handled; after EOF, includes server close. */
  idle(): Promise<void>;
  /** Stop input, flush a trailing record, drain requests, and close Lex once. */
  close(): Promise<void>;
}

export function startLexMcpStdio(
  options: LexMcpStdioOptions,
): LexMcpStdioTransport;
