import { describe, expect, it } from "vitest";
import { createPasswordRecord, DELETE_WINDOW_MS, deletionDecision, normalizeUserId, verifyPassword } from "../src/accessControl.js";

describe("access control", () => {
  const now = Date.parse("2026-06-20T12:00:00.000Z");

  it("allows only the owner during the first 12 hours", () => {
    const recent = { createdBy: "alice", createdAt: new Date(now - DELETE_WINDOW_MS + 1).toISOString() };
    const expired = { createdBy: "alice", createdAt: new Date(now - DELETE_WINDOW_MS).toISOString() };
    expect(deletionDecision(recent, "alice", false, now).allowed).toBe(true);
    expect(deletionDecision(expired, "alice", false, now).allowed).toBe(false);
    expect(deletionDecision(recent, "bob", false, now).allowed).toBe(false);
    expect(deletionDecision({}, "alice", false, now).allowed).toBe(false);
    expect(deletionDecision({}, "", true, now).allowed).toBe(true);
  });

  it("normalizes user ids and rejects invalid values", () => {
    expect(normalizeUserId("  张三  ")).toBe("张三");
    expect(() => normalizeUserId("a")).toThrow();
  });

  it("stores a salted password hash and verifies it", async () => {
    const record = await createPasswordRecord("admin", "password-123");
    expect(record.passwordHash).not.toContain("password-123");
    await expect(verifyPassword(record, "admin", "password-123")).resolves.toBe(true);
    await expect(verifyPassword(record, "admin", "wrong-password")).resolves.toBe(false);
  });
});
