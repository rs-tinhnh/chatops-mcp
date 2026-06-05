import { describe, it, expect, vi, beforeEach } from "vitest";
import { MattermostClient } from "../src/client.js";

function res(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

const cfg = { baseUrl: "https://x", username: "u", password: "p" };

describe("MattermostClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reuses a valid stored token without minting", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }))          // GET /users/me (verify)
      .mockResolvedValueOnce(res([{ id: "t1" }]));        // GET /users/me/teams
    vi.stubGlobal("fetch", fetchMock);

    const mintToken = vi.fn();
    const c = new MattermostClient(cfg, {
      mintToken,
      loadToken: () => "stored-tok",
      saveToken: vi.fn(),
    });

    const teams = await c.get("/users/me/teams");
    expect(teams).toEqual([{ id: "t1" }]);
    expect(mintToken).not.toHaveBeenCalled();
    expect(c.userId).toBe("me1");
    expect(fetchMock.mock.calls[1][1].headers["Authorization"]).toBe("Bearer stored-tok");
  });

  it("mints and saves a token via SSO when no stored token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }))          // verify minted token
      .mockResolvedValueOnce(res({ ok: true }));          // GET
    vi.stubGlobal("fetch", fetchMock);

    const saveToken = vi.fn();
    const c = new MattermostClient(cfg, {
      mintToken: vi.fn().mockResolvedValue("fresh-tok"),
      loadToken: () => null,
      saveToken,
    });

    await c.get("/anything");
    expect(saveToken).toHaveBeenCalledWith("fresh-tok");
    expect(fetchMock.mock.calls[1][1].headers["Authorization"]).toBe("Bearer fresh-tok");
  });

  it("re-mints exactly once on 401 then retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }))          // verify stored
      .mockResolvedValueOnce(res({ message: "expired" }, { status: 401 })) // GET -> 401
      .mockResolvedValueOnce(res({ id: "me1" }))          // verify minted
      .mockResolvedValueOnce(res({ ok: true }));          // retry GET
    vi.stubGlobal("fetch", fetchMock);

    const mintToken = vi.fn().mockResolvedValue("new-tok");
    const c = new MattermostClient(cfg, {
      mintToken,
      loadToken: () => "old-tok",
      saveToken: vi.fn(),
    });

    const out = await c.get("/anything");
    expect(out).toEqual({ ok: true });
    expect(mintToken).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[3][1].headers["Authorization"]).toBe("Bearer new-tok");
  });

  it("throws a clear error when SSO yields no token", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const c = new MattermostClient(cfg, {
      mintToken: vi.fn().mockResolvedValue(""),
      loadToken: () => null,
      saveToken: vi.fn(),
    });
    await expect(c.get("/anything")).rejects.toThrow(/đăng nhập/);
  });
});
