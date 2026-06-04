import { describe, it, expect, vi, beforeEach } from "vitest";
import { MattermostClient } from "../src/client.js";

function res(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("MattermostClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("logs in on first request and reuses the session token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }, { headers: { Token: "tok-1" } })) // login
      .mockResolvedValueOnce(res([{ id: "t1", name: "team" }]));                  // GET teams

    vi.stubGlobal("fetch", fetchMock);
    const c = new MattermostClient({ baseUrl: "https://x", username: "u", password: "p" });

    const teams = await c.get("/users/me/teams");
    expect(teams).toEqual([{ id: "t1", name: "team" }]);

    const loginCall = fetchMock.mock.calls[0];
    expect(loginCall[0]).toBe("https://x/api/v4/users/login");
    expect(JSON.parse(loginCall[1].body)).toEqual({ login_id: "u", password: "p" });

    const getCall = fetchMock.mock.calls[1];
    expect(getCall[1].headers["Authorization"]).toBe("Bearer tok-1");
  });

  it("re-logs in exactly once on 401 then retries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }, { headers: { Token: "tok-1" } })) // login
      .mockResolvedValueOnce(res({ message: "expired" }, { status: 401 }))        // GET -> 401
      .mockResolvedValueOnce(res({ id: "me1" }, { headers: { Token: "tok-2" } })) // re-login
      .mockResolvedValueOnce(res({ ok: true }));                                  // retry GET

    vi.stubGlobal("fetch", fetchMock);
    const c = new MattermostClient({ baseUrl: "https://x", username: "u", password: "p" });

    const out = await c.get("/anything");
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].headers["Authorization"]).toBe("Bearer tok-2");
  });

  it("throws a clear error when re-login still fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res({ id: "me1" }, { headers: { Token: "tok-1" } }))
      .mockResolvedValueOnce(res({ message: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(res({ message: "bad creds" }, { status: 401 }));     // re-login fails

    vi.stubGlobal("fetch", fetchMock);
    const c = new MattermostClient({ baseUrl: "https://x", username: "u", password: "p" });

    await expect(c.get("/anything")).rejects.toThrow(/đăng nhập thất bại/);
  });
});
