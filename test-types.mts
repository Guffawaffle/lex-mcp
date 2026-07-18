import type { PostgresTrustedRuntimeHostV1 } from "@smartergpt/lex/runtime-scope";
import type { ScopedFrameStoreBinder } from "@smartergpt/lex/store";

import {
  startLexMcpStdio,
  type LexMcpStdioOptions,
  type LexMcpStdioTransport,
} from "@smartergpt/lex-mcp";

declare const host: PostgresTrustedRuntimeHostV1<ScopedFrameStoreBinder>;

const options: LexMcpStdioOptions = { serverOptions: host.mcp };
const transport: LexMcpStdioTransport = startLexMcpStdio(options);
void transport;
