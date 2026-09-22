import { describe, it, expect } from "vitest";
import { idempotencyKey } from "./idempotency";

describe("idempotencyKey", () => {
  it("joins parts with underscores", () => {
    expect(idempotencyKey("upload", "doc123", "user456")).toBe("upload_doc123_user456");
  });

  it("is deterministic for the same input", () => {
    expect(idempotencyKey("a", "b")).toBe(idempotencyKey("a", "b"));
  });

  it("produces different keys for different inputs", () => {
    expect(idempotencyKey("a", "b")).not.toBe(idempotencyKey("a", "c"));
  });

  it("throws if called with no parts", () => {
    expect(() => idempotencyKey()).toThrow(/at least one part/);
  });
});
