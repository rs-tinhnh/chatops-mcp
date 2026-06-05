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
