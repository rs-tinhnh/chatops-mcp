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
