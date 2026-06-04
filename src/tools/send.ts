import { z } from "zod";
import type { ToolCtx } from "./read.js";

function assertNonEmpty(message: string): void {
  if (!message || !message.trim()) throw new Error("Tin nhắn rỗng — không gửi.");
}

export function sendMessageTool(ctx: ToolCtx) {
  return {
    name: "send_message",
    description: "Gửi một tin nhắn vào channel theo tên.",
    schema: {
      channel: z.string().describe("Tên channel"),
      message: z.string().describe("Nội dung tin nhắn"),
    },
    handler: async (args: { channel: string; message: string }) => {
      assertNonEmpty(args.message);
      const ch = await ctx.resolver.resolveChannel(args.channel);
      const post = await ctx.client.post<{ id: string }>("/posts", {
        channel_id: ch.id,
        message: args.message,
      });
      return `Đã gửi vào channel '${ch.name}' (post ${post.id}).`;
    },
  };
}

export function replyToThreadTool(ctx: ToolCtx) {
  return {
    name: "reply_to_thread",
    description: "Trả lời vào một thread trong channel.",
    schema: {
      channel: z.string().describe("Tên channel chứa thread"),
      thread_id: z.string().describe("Root post id của thread (hoặc post id bất kỳ trong thread)"),
      message: z.string().describe("Nội dung trả lời"),
    },
    handler: async (args: { channel: string; thread_id: string; message: string }) => {
      assertNonEmpty(args.message);
      const ch = await ctx.resolver.resolveChannel(args.channel);
      const post = await ctx.client.post<{ id: string }>("/posts", {
        channel_id: ch.id,
        message: args.message,
        root_id: args.thread_id,
      });
      return `Đã trả lời thread ${args.thread_id} trong '${ch.name}' (post ${post.id}).`;
    },
  };
}

export function sendDirectMessageTool(ctx: ToolCtx) {
  return {
    name: "send_direct_message",
    description: "Gửi tin nhắn riêng (DM) cho một người dùng theo username.",
    schema: {
      username: z.string().describe("Username hoặc tên người nhận"),
      message: z.string().describe("Nội dung tin nhắn"),
    },
    handler: async (args: { username: string; message: string }) => {
      assertNonEmpty(args.message);
      const user = await ctx.resolver.resolveUser(args.username);
      const dm = await ctx.client.post<{ id: string }>("/channels/direct", [
        ctx.client.userId,
        user.id,
      ]);
      const post = await ctx.client.post<{ id: string }>("/posts", {
        channel_id: dm.id,
        message: args.message,
      });
      return `Đã gửi DM cho '${user.username}' (post ${post.id}).`;
    },
  };
}
