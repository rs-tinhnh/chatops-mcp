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
