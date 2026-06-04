export interface Post {
  id: string;
  user_id: string;
  message: string;
  create_at: number;
  root_id: string;
}

export interface PostList {
  order: string[];
  posts: Record<string, Post>;
}

function ts(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

export function formatPosts(list: PostList, usernames: Record<string, string>): string {
  const ids = [...list.order].reverse(); // API is newest-first → make oldest-first
  if (ids.length === 0) return "(không có tin nhắn)";

  const lines: string[] = [];
  for (const id of ids) {
    const p = list.posts[id];
    if (!p) continue;
    const who = usernames[p.user_id] ?? p.user_id;
    const isReply = p.root_id && p.root_id !== p.id;
    const prefix = isReply ? `  ↳ [thread ${p.root_id}] ` : `[${p.id}] `;
    lines.push(`${prefix}${who} (${ts(p.create_at)}): ${p.message}`);
  }
  return lines.join("\n");
}
