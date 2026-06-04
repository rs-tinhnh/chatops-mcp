import { z } from "zod";
import type { MattermostClient } from "../client.js";
import type { Resolver } from "../resolver.js";
import { formatPosts, type PostList } from "../format.js";

export interface ToolCtx {
  client: MattermostClient;
  resolver: Resolver;
}

const TYPE_LABEL: Record<string, string> = { O: "public", P: "private", D: "DM", G: "group" };

export async function renderPostList(ctx: ToolCtx, list: PostList): Promise<string> {
  const ids = Object.values(list.posts).map((p) => p.user_id);
  const usernames = await ctx.resolver.usernamesByIds([...new Set(ids)]);
  return formatPosts(list, usernames);
}

export function listChannelsTool(ctx: ToolCtx) {
  return {
    name: "list_channels",
    description: "Liệt kê các channel mà bạn đang là thành viên (kèm loại public/private/DM).",
    schema: { query: z.string().optional().describe("Lọc theo tên gần đúng (tùy chọn)") },
    handler: async (args: { query?: string }) => {
      let chans = await ctx.resolver.getChannels();
      if (args.query) {
        const q = args.query.toLowerCase();
        chans = chans.filter(
          (c) => c.name.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q),
        );
      }
      if (!chans.length) return "(không có channel)";
      return chans
        .map((c) => `${c.name} — "${c.display_name}" [${TYPE_LABEL[c.type] ?? c.type}]`)
        .join("\n");
    },
  };
}

export function readChannelTool(ctx: ToolCtx) {
  return {
    name: "read_channel",
    description: "Đọc các tin nhắn gần nhất trong một channel theo tên.",
    schema: {
      channel: z.string().describe("Tên hoặc display name của channel"),
      limit: z.number().int().min(1).max(200).default(30).describe("Số tin nhắn (mặc định 30)"),
    },
    handler: async (args: { channel: string; limit?: number }) => {
      const ch = await ctx.resolver.resolveChannel(args.channel);
      const per = args.limit ?? 30;
      const list = await ctx.client.get<PostList>(`/channels/${ch.id}/posts?per_page=${per}`);
      const body = await renderPostList(ctx, list);
      return `# ${ch.display_name} (${ch.name})\n${body}`;
    },
  };
}

export function readThreadTool(ctx: ToolCtx) {
  return {
    name: "read_thread",
    description: "Đọc toàn bộ tin nhắn trong một thread (truyền id của bất kỳ post nào trong thread).",
    schema: {
      channel: z.string().describe("Tên channel chứa thread"),
      thread_id: z.string().describe("Post id (root hoặc reply) thuộc thread"),
    },
    handler: async (args: { channel: string; thread_id: string }) => {
      await ctx.resolver.resolveChannel(args.channel); // validate channel name
      const list = await ctx.client.get<PostList>(`/posts/${args.thread_id}/thread`);
      return renderPostList(ctx, list);
    },
  };
}

export function searchMessagesTool(ctx: ToolCtx) {
  return {
    name: "search_messages",
    description: "Tìm tin nhắn theo từ khóa trên tất cả các team bạn tham gia.",
    schema: {
      query: z.string().describe("Từ khóa tìm kiếm"),
      limit: z.number().int().min(1).max(100).default(20),
    },
    handler: async (args: { query: string; limit?: number }) => {
      const teams = await ctx.resolver.getTeams();
      const results: PostList[] = [];
      for (const t of teams) {
        const r = await ctx.client.post<PostList>(`/teams/${t.id}/posts/search`, {
          terms: args.query,
          is_or_search: false,
        });
        if (r.order?.length) results.push(r);
      }
      if (!results.length) return "(không tìm thấy tin nhắn nào)";
      const merged: PostList = { order: [], posts: {} };
      for (const r of results) {
        merged.order.push(...r.order);
        Object.assign(merged.posts, r.posts);
      }
      merged.order = merged.order.slice(0, args.limit ?? 20);
      return renderPostList(ctx, merged);
    },
  };
}
