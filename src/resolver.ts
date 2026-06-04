import type { MattermostClient } from "./client.js";

export interface Team { id: string; name: string; display_name?: string; }
export interface Channel { id: string; name: string; display_name: string; type: string; team_id: string; }
export interface User { id: string; username: string; first_name?: string; last_name?: string; }

export class Resolver {
  private teams: Team[] | null = null;
  private channelByName = new Map<string, Channel>();
  private allChannels: Channel[] | null = null;
  private usernameById = new Map<string, string>();

  constructor(private client: MattermostClient) {}

  async getTeams(): Promise<Team[]> {
    if (!this.teams) this.teams = await this.client.get<Team[]>("/users/me/teams");
    return this.teams;
  }

  async getChannels(): Promise<Channel[]> {
    if (this.allChannels) return this.allChannels;
    const teams = await this.getTeams();
    const all: Channel[] = [];
    for (const t of teams) {
      const chans = await this.client.get<Omit<Channel, "team_id">[]>(
        `/users/me/teams/${t.id}/channels`,
      );
      for (const c of chans) all.push({ ...c, team_id: t.id });
    }
    this.allChannels = all;
    for (const c of all) this.channelByName.set(c.name.toLowerCase(), c);
    return all;
  }

  async resolveChannel(nameOrDisplay: string): Promise<Channel> {
    const key = nameOrDisplay.toLowerCase();
    if (this.channelByName.has(key)) return this.channelByName.get(key)!;

    const all = await this.getChannels();
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
    const target = norm(nameOrDisplay);
    const found =
      all.find((c) => c.name.toLowerCase() === key) ??
      all.find((c) => norm(c.display_name) === target) ??
      all.find((c) => norm(c.name) === target);

    if (!found) {
      const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const t = compact(nameOrDisplay);
      const sharedPrefix = (a: string, b: string) => {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return i;
      };
      const similar = (c: Channel) => {
        const cn = compact(c.name);
        const cd = compact(c.display_name);
        if (!t) return false;
        if (cn.includes(t) || t.includes(cn) || cd.includes(t) || t.includes(cd)) return true;
        // tolerate small differences (e.g. "teamfe" vs "teambe") via shared prefix
        const threshold = Math.max(3, Math.ceil(t.length * 0.6));
        return sharedPrefix(t, cn) >= threshold || sharedPrefix(t, cd) >= threshold;
      };
      const near = all
        .filter(similar)
        .slice(0, 5)
        .map((c) => c.name);
      const hint = near.length ? ` Các channel gần giống: ${near.join(", ")}` : "";
      throw new Error(`Không thấy channel '${nameOrDisplay}'.${hint}`);
    }
    this.channelByName.set(key, found);
    return found;
  }

  async resolveUser(query: string): Promise<User> {
    const users = await this.client.post<User[]>("/users/search", { term: query });
    if (!users.length) throw new Error(`Không thấy user '${query}'.`);
    return users[0];
  }

  async usernamesByIds(ids: string[]): Promise<Record<string, string>> {
    const missing = ids.filter((id) => !this.usernameById.has(id));
    if (missing.length) {
      const users = await this.client.post<User[]>("/users/ids", missing);
      for (const u of users) this.usernameById.set(u.id, u.username);
    }
    const out: Record<string, string> = {};
    for (const id of ids) out[id] = this.usernameById.get(id) ?? id;
    return out;
  }
}
