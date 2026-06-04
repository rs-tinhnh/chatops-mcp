import { z } from "zod";
import type { ToolCtx } from "./read.js";
import type { User } from "../resolver.js";

export function findUserTool(ctx: ToolCtx) {
  return {
    name: "find_user",
    description: "Tìm người dùng theo tên/username để xác nhận đúng người trước khi DM.",
    schema: { query: z.string().describe("Tên hoặc username cần tìm") },
    handler: async (args: { query: string }) => {
      const users = await ctx.client.post<User[]>("/users/search", { term: args.query });
      if (!users.length) return `Không thấy người dùng khớp '${args.query}'.`;
      return users
        .map((u) => {
          const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
          return `@${u.username}${full ? ` — ${full}` : ""} (id ${u.id})`;
        })
        .join("\n");
    },
  };
}
