import { describe, it, expect, vi } from "vitest";
import { readChannelTool, listChannelsTool } from "../src/tools/read.js";

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
