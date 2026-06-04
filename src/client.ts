export interface ClientConfig {
  baseUrl: string;
  username: string;
  password: string;
}

export class MattermostClient {
  private token: string | null = null;
  userId: string | null = null;
  private readonly api: string;

  constructor(private cfg: ClientConfig) {
    this.api = cfg.baseUrl.replace(/\/$/, "") + "/api/v4";
  }

  private async login(): Promise<void> {
    const r = await fetch(`${this.api}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login_id: this.cfg.username, password: this.cfg.password }),
    });
    if (!r.ok) {
      throw new Error("đăng nhập thất bại, kiểm tra credential (MATTERMOST_USERNAME/PASSWORD)");
    }
    this.token = r.headers.get("Token");
    const me = (await r.json()) as { id: string };
    this.userId = me.id;
    if (!this.token) throw new Error("đăng nhập thất bại: không nhận được session token");
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    if (!this.token) await this.login();
    const doFetch = () =>
      fetch(`${this.api}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
      });

    let r = await doFetch();
    if (r.status === 401) {
      await this.login(); // re-login exactly once
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
