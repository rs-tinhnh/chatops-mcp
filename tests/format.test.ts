import { describe, it, expect } from "vitest";
import { formatPosts } from "../src/format.js";

describe("formatPosts", () => {
  it("renders posts oldest-first with username and time, grouping replies under their root", () => {
    const data = {
      order: ["p3", "p2", "p1"], // API returns newest-first
      posts: {
        p1: { id: "p1", user_id: "u1", message: "hello", create_at: 1700000000000, root_id: "" },
        p2: { id: "p2", user_id: "u2", message: "a reply", create_at: 1700000100000, root_id: "p1" },
        p3: { id: "p3", user_id: "u1", message: "new topic", create_at: 1700000200000, root_id: "" },
      },
    };
    const usernames = { u1: "alice", u2: "bob" };
    const text = formatPosts(data, usernames);

    expect(text).toContain("alice");
    expect(text).toContain("hello");
    expect(text).toContain("↳"); // reply marker
    expect(text).toContain("a reply");
    expect(text).toContain("p1"); // thread id surfaced
    expect(text.indexOf("hello")).toBeLessThan(text.indexOf("new topic")); // oldest-first
  });

  it("returns a friendly message when there are no posts", () => {
    expect(formatPosts({ order: [], posts: {} }, {})).toBe("(không có tin nhắn)");
  });
});
