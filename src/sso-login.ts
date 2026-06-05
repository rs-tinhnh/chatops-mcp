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
