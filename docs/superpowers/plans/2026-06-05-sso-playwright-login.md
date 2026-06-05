# SSO Playwright Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the disabled email/password API login with a Playwright-driven Keycloak SSO flow that mints a Mattermost session token, while leaving every other API call unchanged.

**Architecture:** Playwright opens `chat.runsystem.vn/oauth/gitlab/login`, which 302-redirects to the Keycloak login form; it fills username/password, submits, and reads the `MMAUTHTOKEN` cookie. That cookie value is used as `Authorization: Bearer <token>` for `/api/v4` exactly as today. The token is persisted to disk and reused until it returns 401, at which point the SSO flow re-runs. The browser flow is injected into `MattermostClient` as a dependency so the client stays unit-testable without launching a browser.

**Tech Stack:** TypeScript (ES2022, NodeNext), Playwright (Chromium), vitest, `@modelcontextprotocol/sdk`.

---

## File Structure

- **Create** `src/session-store.ts` — pure helpers to load/save the token JSON file (mode 600). One responsibility: on-disk session persistence.
- **Create** `src/sso-login.ts` — `ssoLogin(cfg)`: drives Chromium through Keycloak and returns the token. One responsibility: minting a token via the browser.
- **Modify** `src/client.ts` — `login()` now reuses a stored token or calls the injected mint function; verifies via `GET /users/me` (also sets `userId`). Adds an optional `deps` constructor arg for injection.
- **Modify** `tests/client.test.ts` — rewrite to inject a fake mint/load/save instead of mocking `/users/login`.
- **Create** `tests/session-store.test.ts` — round-trip + edge cases for the store.
- **Modify** `package.json` — add `playwright` dependency.
- **Modify** `README.md` — env table, `npx playwright install chromium` step, security note.
- **Modify** `scripts/smoke.ts` — note that login now opens a browser; honor `CHATOPS_HEADFUL`.

---

## Task 1: Add Playwright dependency

**Files:**
- Modify: `package.json:14-17`

- [ ] **Step 1: Add the dependency**

Edit `package.json` `dependencies` to add Playwright (keep `@modelcontextprotocol/sdk` and `zod`):

```json
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "playwright": "^1.48.0",
    "zod": "^3.23.0"
  },
```

- [ ] **Step 2: Install**

Run: `npm install && npx playwright install chromium`
Expected: install completes; Chromium downloaded.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add playwright dependency"
```

---

## Task 2: Session store

**Files:**
- Create: `src/session-store.ts`
- Test: `tests/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/session-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSession, saveSession } from "../src/session-store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chatops-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("session-store", () => {
  it("round-trips a token through save then load", () => {
    const path = join(dir, "nested", "session.json");
    saveSession(path, "tok-abc");
    expect(loadSession(path)).toBe("tok-abc");
  });

  it("writes the file with 0600 permissions", () => {
    const path = join(dir, "session.json");
    saveSession(path, "tok-abc");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("returns null when the file does not exist", () => {
    expect(loadSession(join(dir, "missing.json"))).toBeNull();
  });

  it("returns null when the file is malformed", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, "not json");
    expect(loadSession(path)).toBeNull();
  });

  it("returns null when the token field is missing or empty", () => {
    const path = join(dir, "empty.json");
    writeFileSync(path, JSON.stringify({ token: "" }));
    expect(loadSession(path)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session-store.test.ts`
Expected: FAIL — cannot resolve `../src/session-store.js`.

- [ ] **Step 3: Write the implementation**

Create `src/session-store.ts`:

```ts
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export function defaultSessionPath(): string {
  return (
    process.env.CHATOPS_SESSION_PATH ??
    join(homedir(), ".chatops-mcp", "session.json")
  );
}

export function loadSession(path: string): string | null {
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown };
    return typeof data.token === "string" && data.token ? data.token : null;
  } catch {
    return null;
  }
}

export function saveSession(path: string, token: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify({ token, savedAt: new Date().toISOString() }), {
    mode: 0o600,
  });
  chmodSync(path, 0o600); // enforce mode even if the file already existed
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/session-store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session-store.ts tests/session-store.test.ts
git commit -m "feat: on-disk session token store"
```

---

## Task 3: Playwright SSO login

**Files:**
- Create: `src/sso-login.ts`

Note: this module launches a real browser, so it is covered by the manual smoke test (Task 5), not by a unit test. Verification here is a type-check/build.

- [ ] **Step 1: Write the implementation**

Create `src/sso-login.ts`:

```ts
import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClientConfig } from "./client.js";

// Logs in through the Keycloak SSO flow and returns the Mattermost session
// token (the MMAUTHTOKEN cookie value). Mattermost labels the provider
// "gitlab", but /oauth/gitlab/login 302s straight to Keycloak.
export async function ssoLogin(cfg: ClientConfig): Promise<string> {
  const headful = process.env.CHATOPS_HEADFUL === "1";
  const timeout = Number(process.env.CHATOPS_LOGIN_TIMEOUT_MS ?? 30000);
  const base = cfg.baseUrl.replace(/\/$/, "");
  const host = new URL(base).host;

  const browser = await chromium.launch({ headless: !headful });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    // 302s directly to the Keycloak login form — no button to click.
    await page.goto(`${base}/oauth/gitlab/login`);

    await page.fill("#username", cfg.username);
    await page.fill("#password", cfg.password);
    await page.click('input.submit[type="submit"]');

    // Wait until Keycloak has redirected back to the Mattermost host.
    await page.waitForURL((url) => url.host === host, { timeout });

    const cookies = await context.cookies();
    const token = cookies.find((c) => c.name === "MMAUTHTOKEN")?.value;
    if (!token) {
      const shot = join(tmpdir(), "chatops-login-error.png");
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(
        `đăng nhập SSO thất bại: không thấy cookie MMAUTHTOKEN (đang ở ${page.url()}). Ảnh debug: ${shot}`,
      );
    }
    return token;
  } catch (err) {
    if (err instanceof Error && err.message.includes("MMAUTHTOKEN")) throw err;
    throw new Error(
      `đăng nhập SSO thất bại: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: compiles with no errors (note: this also depends on Task 4's `ClientConfig` export, which already exists in `src/client.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/sso-login.ts
git commit -m "feat: keycloak SSO login via playwright"
```

---

## Task 4: Wire SSO into MattermostClient

**Files:**
- Modify: `src/client.ts` (entire file)
- Test: `tests/client.test.ts` (rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/client.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/client.test.ts`
Expected: FAIL — `MattermostClient` constructor does not accept a second `deps` arg / `mintToken` path not implemented.

- [ ] **Step 3: Rewrite the client**

Replace the entire contents of `src/client.ts`:

```ts
import { ssoLogin } from "./sso-login.js";
import { defaultSessionPath, loadSession, saveSession } from "./session-store.js";

export interface ClientConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export interface ClientDeps {
  mintToken?: (cfg: ClientConfig) => Promise<string>;
  loadToken?: () => string | null;
  saveToken?: (token: string) => void;
}

export class MattermostClient {
  private token: string | null = null;
  private loginPromise: Promise<void> | null = null;
  userId: string | null = null;
  private readonly api: string;
  private readonly mintToken: (cfg: ClientConfig) => Promise<string>;
  private readonly loadToken: () => string | null;
  private readonly saveToken: (token: string) => void;

  constructor(private cfg: ClientConfig, deps: ClientDeps = {}) {
    this.api = cfg.baseUrl.replace(/\/$/, "") + "/api/v4";
    this.mintToken = deps.mintToken ?? ssoLogin;
    this.loadToken = deps.loadToken ?? (() => loadSession(defaultSessionPath()));
    this.saveToken = deps.saveToken ?? ((t) => saveSession(defaultSessionPath(), t));
  }

  // Returns true and sets userId if the token is accepted by the server.
  private async verify(token: string): Promise<boolean> {
    const r = await fetch(`${this.api}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return false;
    const me = (await r.json()) as { id: string };
    this.userId = me.id;
    return true;
  }

  private async login(force: boolean): Promise<void> {
    if (!force) {
      const stored = this.loadToken();
      if (stored && (await this.verify(stored))) {
        this.token = stored;
        return;
      }
    }
    const token = await this.mintToken(this.cfg);
    if (!token) throw new Error("đăng nhập thất bại: không lấy được session token");
    if (!(await this.verify(token))) {
      throw new Error("đăng nhập thất bại: token không hợp lệ sau khi đăng nhập SSO");
    }
    this.saveToken(token);
    this.token = token;
  }

  private async ensureLogin(force = false): Promise<void> {
    if (force) this.token = null;
    if (this.token) return;
    if (!this.loginPromise) {
      this.loginPromise = this.login(force).finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    await this.ensureLogin();
    const doFetch = () =>
      fetch(`${this.api}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
          Authorization: `Bearer ${this.token}`,
        },
      });

    let r = await doFetch();
    if (r.status === 401) {
      await this.ensureLogin(true); // re-login exactly once
      r = await doFetch();
    }
    return r;
  }

  private async json<T>(path: string, init: RequestInit): Promise<T> {
    const r = await this.raw(path, init);
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Không gọi được Mattermost: ${r.status} ${text || r.statusText}`);
    }
    return (await r.json()) as T;
  }

  get<T = unknown>(path: string): Promise<T> {
    return this.json<T>(path, { method: "GET" });
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, { method: "POST", body: JSON.stringify(body) });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite + build**

Run: `npx vitest run && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat: reuse stored token, mint via SSO on miss/401"
```

---

## Task 5: Docs and smoke test

**Files:**
- Modify: `scripts/smoke.ts:1-2`
- Modify: `README.md`

- [ ] **Step 1: Update the smoke-test header comment**

In `scripts/smoke.ts` replace the top two comment lines:

```ts
// scripts/smoke.ts — manual end-to-end check against the real server. NOT run in CI.
// Opens a real browser for SSO login (set CHATOPS_HEADFUL=1 to watch it).
// Usage: MATTERMOST_URL=... MATTERMOST_USERNAME=... MATTERMOST_PASSWORD=... CHANNEL=town-square npm run smoke
```

(No code changes — login happens internally when `resolver.getChannels()` runs.)

- [ ] **Step 2: Update the README config + setup**

In `README.md`, under "Cài đặt / build", append the Playwright browser step after `npm run build`:

```bash
npx playwright install chromium   # tải Chromium cho login SSO
```

Replace the env block in the `.mcp.json` example and add the SSO note. The env table stays the same three required vars (`MATTERMOST_URL`, `MATTERMOST_USERNAME`, `MATTERMOST_PASSWORD`); add this paragraph right after the JSON block:

```markdown
Login đi qua SSO Keycloak (`sso.runsystem.vn`): server mở Chromium (Playwright),
điền `MATTERMOST_USERNAME`/`MATTERMOST_PASSWORD` vào form đăng nhập, rồi lấy
session token. Env phụ: `CHATOPS_HEADFUL=1` để xem browser, `CHATOPS_LOGIN_TIMEOUT_MS`
(mặc định 30000), `CHATOPS_SESSION_PATH` để đổi nơi lưu session.
```

Replace the security sentence ("Session token chỉ giữ trong RAM...") with:

```markdown
Credential chỉ nằm trong env (không log). Session token được lưu ra
`~/.chatops-mcp/session.json` (quyền 600) và tái dùng tới khi hết hạn; khi gặp
401 server tự đăng nhập SSO lại.
```

- [ ] **Step 3: Verify build still clean**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/smoke.ts
git commit -m "docs: document SSO login flow and session persistence"
```

---

## Task 6: Manual smoke verification (real server)

**Files:** none (manual run)

- [ ] **Step 1: Run the smoke test against the real server**

Run:
```bash
CHATOPS_HEADFUL=1 MATTERMOST_URL=https://chat.runsystem.vn \
  MATTERMOST_USERNAME='<email>' MATTERMOST_PASSWORD='<password>' \
  CHANNEL=town-square npm run smoke
```
Expected: a browser opens, logs in via Keycloak, then console prints `Login OK. Bạn đang ở N channel.` followed by the 5 latest messages.

- [ ] **Step 2: Confirm session reuse**

Run the same command again **without** `CHATOPS_HEADFUL`.
Expected: no browser appears (stored token at `~/.chatops-mcp/session.json` is reused); still prints `Login OK`.

---

## Self-Review Notes

- **Spec coverage:** `sso-login.ts` (Keycloak flow, selectors `#username`/`#password`/`input.submit`) → Task 3; session persistence + 600 perms + `CHATOPS_SESSION_PATH` → Task 2; token reuse + 401 re-login + `userId` via `/users/me` → Task 4; env vars + README security note → Task 5; playwright dep + `install chromium` → Tasks 1 & 5; `CHATOPS_HEADFUL`/`CHATOPS_LOGIN_TIMEOUT_MS` → Task 3 & README. Out-of-scope items (MFA, non-Keycloak IdP, API password fallback) intentionally absent.
- **Type consistency:** `ClientConfig` and `ClientDeps` (with `mintToken`/`loadToken`/`saveToken`) defined in Task 4 `src/client.ts`; `ssoLogin(cfg: ClientConfig)` in Task 3 imports that type; `loadSession`/`saveSession`/`defaultSessionPath` defined in Task 2 and consumed in Task 4. Names match across tasks.
- **No placeholders:** every code step contains full file contents or exact snippets.
