import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MattermostClient } from "./client.js";
import { Resolver } from "./resolver.js";
import type { ToolCtx } from "./tools/read.js";
import {
  listChannelsTool,
  readChannelTool,
  readThreadTool,
  searchMessagesTool,
} from "./tools/read.js";
import {
  sendMessageTool,
  replyToThreadTool,
  sendDirectMessageTool,
} from "./tools/send.js";
import { findUserTool } from "./tools/users.js";

export function buildServer(): McpServer {
  const baseUrl = process.env.MATTERMOST_URL;
  const username = process.env.MATTERMOST_USERNAME;
  const password = process.env.MATTERMOST_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error(
      "Thiếu cấu hình: cần MATTERMOST_URL, MATTERMOST_USERNAME, MATTERMOST_PASSWORD.",
    );
  }

  const client = new MattermostClient({ baseUrl, username, password });
  const resolver = new Resolver(client);
  const ctx: ToolCtx = { client, resolver };

  const server = new McpServer({ name: "chatops-mcp", version: "0.1.0" });

  const tools = [
    listChannelsTool(ctx),
    readChannelTool(ctx),
    readThreadTool(ctx),
    searchMessagesTool(ctx),
    sendMessageTool(ctx),
    replyToThreadTool(ctx),
    sendDirectMessageTool(ctx),
    findUserTool(ctx),
  ];

  for (const t of tools) {
    server.tool(t.name, t.description, t.schema as any, async (args: any) => {
      try {
        const text = await t.handler(args);
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: msg }], isError: true };
      }
    });
  }

  return server;
}

export async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
