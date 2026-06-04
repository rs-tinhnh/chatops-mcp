import { describe, it, expect, vi } from "vitest";
import { readChannelTool, listChannelsTool, searchMessagesTool } from "../src/tools/read.js";
import { sendMessageTool, replyToThreadTool, sendDirectMessageTool } from "../src/tools/send.js";

function ctx(overrides: any = {}) {
  const client = { get: vi.fn(), post: vi.fn(), userId: "me1", ...overrides.client };
  const resolver = {
    resolveChannel: vi.fn(),
    resolveUser: vi.fn(),
    usernamesByIds: vi.fn(),
    getChannels: vi.fn(),
    getTeams: vi.fn(),
    ...overrides.resolver,
  };
  return { client, resolver } as any;
}

describe("read_channel", () => {
  it("resolves channel, fetches posts, and renders them with usernames", async () => {
    const c = ctx({
      resolver: {
        resolveChannel: vi.fn(async () => ({ id: "c1", name: "team-be", display_name: "Team BE", type: "O", team_id: "t1" })),
        usernamesByIds: vi.fn(async () => ({ u1: "alice" })),
      },
      client: {
        get: vi.fn(async () => ({
          order: ["p1"],
          posts: { p1: { id: "p1", user_id: "u1", message: "hi", create_at: 1700000000000, root_id: "" } },
        })),
      },
    });
    const tool = readChannelTool(c);
    const out = await tool.handler({ channel: "team-be", limit: 30 });

    expect(c.resolver.resolveChannel).toHaveBeenCalledWith("team-be");
    expect(c.client.get).toHaveBeenCalledWith("/channels/c1/posts?per_page=30");
    expect(out).toContain("alice");
    expect(out).toContain("hi");
  });
});

describe("list_channels", () => {
  it("lists channels the user belongs to with type labels", async () => {
    const c = ctx({
      resolver: {
        getChannels: vi.fn(async () => [
          { id: "c1", name: "team-be", display_name: "Team BE", type: "O", team_id: "t1" },
          { id: "c2", name: "secret", display_name: "Secret", type: "P", team_id: "t1" },
        ]),
      },
    });
    const tool = listChannelsTool(c);
    const out = await tool.handler({});
    expect(out).toContain("team-be");
    expect(out).toContain("public");
    expect(out).toContain("secret");
    expect(out).toContain("private");
  });
});

describe("search_messages", () => {
  it("searches each team, merges results, applies the limit, and renders usernames", async () => {
    const c = ctx({
      resolver: {
        getTeams: vi.fn(async () => [{ id: "t1", name: "t1" }, { id: "t2", name: "t2" }]),
        usernamesByIds: vi.fn(async () => ({ u1: "alice", u2: "bob" })),
      },
      client: {
        post: vi.fn(async (path: string) => {
          if (path === "/teams/t1/posts/search") {
            return { order: ["p1"], posts: { p1: { id: "p1", user_id: "u1", message: "from t1", create_at: 1700000000000, root_id: "" } } };
          }
          return { order: ["p2"], posts: { p2: { id: "p2", user_id: "u2", message: "from t2", create_at: 1700000100000, root_id: "" } } };
        }),
      },
    });
    const tool = searchMessagesTool(c);
    const out = await tool.handler({ query: "hello", limit: 5 });

    // searched both teams with the correct payload
    expect(c.client.post).toHaveBeenCalledWith("/teams/t1/posts/search", { terms: "hello", is_or_search: false });
    expect(c.client.post).toHaveBeenCalledWith("/teams/t2/posts/search", { terms: "hello", is_or_search: false });
    // merged results from both teams are rendered
    expect(out).toContain("from t1");
    expect(out).toContain("from t2");
    expect(out).toContain("alice");
    expect(out).toContain("bob");
  });

  it("reports when nothing is found", async () => {
    const c = ctx({
      resolver: { getTeams: vi.fn(async () => [{ id: "t1", name: "t1" }]) },
      client: { post: vi.fn(async () => ({ order: [], posts: {} })) },
    });
    const tool = searchMessagesTool(c);
    const out = await tool.handler({ query: "nope" });
    expect(out).toContain("(không tìm thấy tin nhắn nào)");
  });
});

describe("send_message", () => {
  it("rejects empty messages without calling the API", async () => {
    const c = ctx({ client: { post: vi.fn() } });
    const tool = sendMessageTool(c);
    await expect(tool.handler({ channel: "team-be", message: "   " })).rejects.toThrow(/rỗng/);
    expect(c.client.post).not.toHaveBeenCalled();
  });

  it("resolves channel, posts, and confirms the destination", async () => {
    const c = ctx({
      resolver: {
        resolveChannel: vi.fn(async () => ({ id: "c1", name: "team-be", display_name: "Team BE", type: "O", team_id: "t1" })),
      },
      client: { post: vi.fn(async () => ({ id: "newpost1" })) },
    });
    const tool = sendMessageTool(c);
    const out = await tool.handler({ channel: "team-be", message: "hello" });

    expect(c.client.post).toHaveBeenCalledWith("/posts", { channel_id: "c1", message: "hello" });
    expect(out).toContain("team-be");
    expect(out).toContain("newpost1");
  });
});

describe("send_direct_message", () => {
  it("finds user, opens DM channel, posts, and confirms recipient", async () => {
    const c = ctx({
      resolver: { resolveUser: vi.fn(async () => ({ id: "u2", username: "bob" })) },
      client: {
        userId: "me1",
        post: vi.fn(async (path: string) => {
          if (path === "/channels/direct") return { id: "dm1" };
          return { id: "newpost2" };
        }),
      },
    });
    const tool = sendDirectMessageTool(c);
    const out = await tool.handler({ username: "bob", message: "hi bob" });

    expect(c.client.post).toHaveBeenCalledWith("/channels/direct", ["me1", "u2"]);
    expect(c.client.post).toHaveBeenCalledWith("/posts", { channel_id: "dm1", message: "hi bob" });
    expect(out).toContain("bob");
  });
});
