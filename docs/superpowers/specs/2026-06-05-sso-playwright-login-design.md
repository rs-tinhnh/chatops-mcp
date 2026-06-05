# SSO login via Playwright — design

Date: 2026-06-05
Status: Approved (pending spec review)

## Problem

`chat.runsystem.vn` has email/password API login disabled
(`EnableSignUpWithEmail: false`) and only allows GitLab SSO
(`EnableSignUpWithGitLab: true`). The current `MattermostClient.login()`
POSTs to `/api/v4/users/login`, which the server rejects with
`401 api.user.login.invalid_credentials_sso`. So the MCP server can never
authenticate against this instance.

## Goal

Authenticate by driving the real browser SSO flow with Playwright, extract
the resulting Mattermost session token, and keep every other API call
unchanged.

## Key facts (verified against the live server)

- Real host: `chat.runsystem.vn` (`chatops.runsystem.vn` does not resolve).
- SSO provider: Mattermost labels it "gitlab", but `/oauth/gitlab/login`
  302-redirects straight to **Keycloak** at
  `https://sso.runsystem.vn/auth/realms/master/protocol/openid-connect/auth`
  (client_id `chatops`). The username/password page is the Keycloak login form.
  User logs in with company email/username + password. No intermediate
  "Login with GitLab" button needs clicking — hitting the oauth URL lands
  directly on the Keycloak form.
- After a successful browser login, Mattermost sets the session token in the
  `MMAUTHTOKEN` cookie. That cookie value works directly as
  `Authorization: Bearer <token>` for `/api/v4`, so the rest of the client is
  unaffected.

## Approach

Use Playwright **only to mint a token**. All read/send tools keep calling
`/api/v4` with a Bearer token exactly as today. Rejected alternative: driving
every operation through the browser — slow and brittle.

## Components

### 1. `src/sso-login.ts` (new)

`ssoLogin(cfg: ClientConfig): Promise<string>` returns the session token.

Flow:
1. Launch Chromium headless (headful when `CHATOPS_HEADFUL=1`).
2. `page.goto("https://chat.runsystem.vn/oauth/gitlab/login")`. This 302s
   directly to the Keycloak login form (no button to click).
3. On the Keycloak login page fill the fields and submit. Selectors confirmed
   against the live page:
   - username: `#username` (fallback `input[name="username"]`)
   - password: `#password` (fallback `input[name="password"]`)
   - submit: `input.submit[type="submit"]` (fallback
     `input[type="submit"][value="Sign in"]`)
4. Wait for redirect back to `chat.runsystem.vn`.
5. Read the `MMAUTHTOKEN` cookie from the browser context; that is the token.
6. On failure (wrong creds, changed markup, timeout) throw a clear error that
   includes the current page URL, and save a screenshot to a temp path for
   debugging.

`cfg` reuses the existing env vars: `MATTERMOST_URL`,
`MATTERMOST_USERNAME` (company email), `MATTERMOST_PASSWORD`.

### 2. `src/session-store.ts` (new)

Pure, unit-testable helpers for the on-disk session:
- `loadSession(path): { token } | null`
- `saveSession(path, { token }): void` — writes with mode `600`.
- Default path: `~/.chatops-mcp/session.json`.

### 3. `src/client.ts` (modified)

- `login()` becomes:
  1. If a stored session exists and `GET /api/v4/users/me` with it returns 200,
     reuse that token — no browser launch.
  2. Otherwise call `ssoLogin()`, store the token via `saveSession`, set
     `this.token` and `this.userId`.
- `ensureLogin(force)` and the `raw()` 401-retry path are unchanged in shape;
  a forced re-login now re-runs `login()` (which falls through to `ssoLogin()`
  when the stored session is dead).

## Configuration

| Env | Purpose | Default |
|-----|---------|---------|
| `MATTERMOST_URL` | base URL | required |
| `MATTERMOST_USERNAME` | company email for GitLab login | required |
| `MATTERMOST_PASSWORD` | company password | required |
| `CHATOPS_HEADFUL` | `1` → show browser (debug) | unset (headless) |
| `CHATOPS_LOGIN_TIMEOUT_MS` | per-step navigation timeout | 30000 |
| `CHATOPS_SESSION_PATH` | override session file location | `~/.chatops-mcp/session.json` |

## Security note (README update)

The session token is now persisted to disk at `~/.chatops-mcp/session.json`
(mode 600), replacing the previous "token only in RAM" guarantee. Credentials
remain in env only and are never written to disk or logged.

## Error handling

- Missing config → existing "Thiếu cấu hình" guard in `server.ts` is unchanged.
- Login failure → throw with the real cause (current URL) instead of the old
  generic message; screenshot saved to temp.
- Expired/invalid stored session → transparent re-login via `ssoLogin()`.

## Testing

- Unit tests (vitest): `session-store` load/save/round-trip and permission mode;
  token-from-cookie extraction logic factored as a pure function.
- The live browser SSO flow is not unit-tested (needs a real IdP). It is covered
  by an updated `scripts/smoke.ts` run manually with real env, matching the
  existing smoke-test convention.

## Dependencies

- Add `playwright` to dependencies.
- Document `npx playwright install chromium` in the README setup steps.

## Out of scope

- MFA handling (confirmed not required for this SSO).
- Supporting non-GitLab IdPs.
- Keeping the old API password login as a fallback.
