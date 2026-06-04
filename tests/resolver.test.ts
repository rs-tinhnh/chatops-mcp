import { describe, it, expect, vi } from "vitest";
import { Resolver } from "../src/resolver.js";

function fakeClient(map: Record<string, unknown>) {
  return {
    get: vi.fn(async (path: string) => {
      if (!(path in map)) throw new Error(`unexpected GET ${path}`);
      return map[path];
    }),
    post: vi.fn(async (path: string) => {
      if (!(path in map)) throw new Error(`unexpected POST ${path}`);
      return map[path];
    }),
    userId: "me1",
  } as any;
}

describe("Resolver", () => {
  it("resolves a channel by name across teams and caches it", async () => {
    const client = fakeClient({
      "/users/me/teams": [{ id: "t1", name: "main", display_name: "Main" }],
      "/users/me/teams/t1/channels": [
        { id: "c1", name: "team-be", display_name: "Team BE", type: "O" },
        { id: "c2", name: "random", display_name: "Random", type: "O" },
      ],
    });
    const r = new Resolver(client);

    const ch = await r.resolveChannel("team-be");
    expect(ch).toEqual({ id: "c1", name: "team-be", display_name: "Team BE", type: "O", team_id: "t1" });

    const before = client.get.mock.calls.length;
    await r.resolveChannel("team-be");
    expect(client.get.mock.calls.length).toBe(before);
  });

  it("matches channel by display name case-insensitively", async () => {
    const client = fakeClient({
      "/users/me/teams": [{ id: "t1", name: "main", display_name: "Main" }],
      "/users/me/teams/t1/channels": [{ id: "c1", name: "team-be", display_name: "Team BE", type: "O" }],
    });
    const r = new Resolver(client);
    const ch = await r.resolveChannel("team be");
    expect(ch.id).toBe("c1");
  });

  it("throws a helpful error listing near matches when channel not found", async () => {
    const client = fakeClient({
      "/users/me/teams": [{ id: "t1", name: "main" }],
      "/users/me/teams/t1/channels": [{ id: "c1", name: "team-be", display_name: "Team BE", type: "O" }],
    });
    const r = new Resolver(client);
    await expect(r.resolveChannel("teamfe")).rejects.toThrow(/Không thấy channel 'teamfe'/);
    await expect(r.resolveChannel("teamfe")).rejects.toThrow(/team-be/);
  });

  it("maps user ids to usernames in one batch call and caches", async () => {
    const client = fakeClient({
      "/users/ids": [
        { id: "u1", username: "alice" },
        { id: "u2", username: "bob" },
      ],
    });
    const r = new Resolver(client);
    const names = await r.usernamesByIds(["u1", "u2"]);
    expect(names).toEqual({ u1: "alice", u2: "bob" });
    expect(client.post).toHaveBeenCalledWith("/users/ids", ["u1", "u2"]);
  });
});
