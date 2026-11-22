// Copyright 2026 The Protobuf Project authors.
// SPDX-License-Identifier: Apache-2.0

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { CodemodeRuntime } from "../runtime/runtime.ts";
import { truncateText } from "../runtime/truncate.ts";
import type { CodeOutput } from "../runtime/types.ts";
import { status } from "./status.ts";

/** Options for the Code Mode MCP server. */
export interface McpServerOptions {
  name?: string;
  version?: string;
  /** "code": one code tool. "search_execute": search and execute tools. Defaults to "code". */
  expose?: "code" | "search_execute";
  /** Ask the user through MCP elicitation when a call needs approval. Defaults to true. */
  elicitApproval?: boolean;
  /**
   * List codemode_approve and codemode_reject. Defaults to true. Set false so
   * the model cannot approve its own calls: approval then comes only from
   * elicitation or from your own surface calling runtime.approve().
   */
  approvalTools?: boolean;
  /** Told to the model when an execution is left paused, e.g. where a person approves it. */
  approvalHint?: string;
}

const executionId: Tool["inputSchema"] = {
  type: "object",
  properties: { executionId: { type: "string" } },
  required: ["executionId"],
};

/**
 * Publishes a Code Mode runtime as an MCP server. Paused executions are put
 * to the user through elicitation when the client supports it; otherwise
 * the client resumes them with codemode_approve or codemode_reject, unless
 * approvalTools is false. codemode_status reports how an execution ended.
 */
export function createMcpServer(runtime: CodemodeRuntime, options: McpServerOptions = {}): Server {
  const server = new Server(
    { name: options.name ?? "codemode", version: options.version ?? "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const codeTool = runtime.tool();
  const codeSchema = codeTool.inputSchema as Tool["inputSchema"];
  const tools: Tool[] =
    options.expose === "search_execute"
      ? [
          {
            name: "search",
            description:
              "Find API methods and snippets by keyword. Returns paths to pass to codemode.describe() in execute.",
            inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
          { name: "execute", description: codeTool.description, inputSchema: codeSchema },
        ]
      : [{ name: "code", description: codeTool.description, inputSchema: codeSchema }];
  const approvalTools = options.approvalTools !== false;
  tools.push({
    name: "codemode_status",
    description: "Report an execution's status and result, e.g. after a person approved it elsewhere.",
    inputSchema: executionId,
  });
  if (approvalTools) {
    tools.push(
      {
        name: "codemode_approve",
        description:
          "Approve the call a paused execution is waiting on, and resume it. Pass seq to approve one call; without it every pending call is approved.",
        inputSchema: {
          type: "object",
          properties: { executionId: { type: "string" }, seq: { type: "number" } },
          required: ["executionId"],
        },
      },
      {
        name: "codemode_reject",
        description: "Reject the call a paused execution is waiting on, ending the execution.",
        inputSchema: {
          type: "object",
          properties: { executionId: { type: "string" }, seq: { type: "number" } },
          required: ["executionId", "seq"],
        },
      },
    );
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (request.params.name) {
        case "search":
          return json(await runtime.search(String(args.query ?? "")));
        case "code":
        case "execute":
          return output(
            await settle(server, runtime, await runtime.execute({ code: String(args.code ?? "") }), options),
          );
        case "codemode_status":
          return output(await status(runtime, String(args.executionId)));
        case "codemode_approve":
          if (!approvalTools) return refused(request.params.name);
          return output(
            await settle(
              server,
              runtime,
              await runtime.approve({
                executionId: String(args.executionId),
                ...(args.seq === undefined ? {} : { seq: Number(args.seq) }),
              }),
              options,
            ),
          );
        case "codemode_reject":
          if (!approvalTools) return refused(request.params.name);
          return json({
            rejected: await runtime.reject({ executionId: String(args.executionId), seq: Number(args.seq) }),
          });
        default:
          return { content: [{ type: "text", text: `unknown tool ${request.params.name}` }], isError: true };
      }
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  });
  return server;
}

/** While paused and the client can be asked, asks the user and resumes. */
async function settle(
  server: Server,
  runtime: CodemodeRuntime,
  out: CodeOutput,
  options: McpServerOptions,
): Promise<CodeOutput> {
  let current = out;
  while (
    current.status === "paused" &&
    options.elicitApproval !== false &&
    server.getClientCapabilities()?.elicitation
  ) {
    const p = current.pending[0];
    if (!p) break;
    const answer = await server.elicitInput({
      mode: "form",
      message: `${p.message ?? `Allow ${p.path}?`}\n\n${p.path}(${JSON.stringify(p.args, null, 2)})`,
      requestedSchema: {
        type: "object",
        properties: { approve: { type: "boolean", title: "Approve this call" } },
        required: ["approve"],
      },
    });
    if (answer.action === "accept" && answer.content?.approve === true) {
      current = await runtime.approve({ executionId: current.executionId, seq: p.seq });
    } else {
      await runtime.reject({ executionId: current.executionId, seq: p.seq });
      return { status: "error", executionId: current.executionId, error: `the user declined ${p.path}` };
    }
  }
  if (current.status === "paused" && options.approvalHint) {
    return { ...current, message: options.approvalHint } as CodeOutput;
  }
  return current;
}

function refused(tool: string): CallToolResult {
  return { content: [{ type: "text", text: `${tool} is disabled: a person approves calls` }], isError: true };
}

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: truncateText(JSON.stringify(value, null, 2)) }] };
}

function output(out: CodeOutput): CallToolResult {
  return {
    content: [{ type: "text", text: truncateText(JSON.stringify(out, null, 2)) }],
    structuredContent: out as unknown as Record<string, unknown>,
    isError: out.status === "error",
  };
}
