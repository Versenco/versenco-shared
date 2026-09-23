import { describe, it, expect } from "vitest";
import { idempotencyKey } from "./idempotency";

describe("idempotencyKey", () => {
  it("joins parts with a double-colon separator", () => {
    expect(idempotencyKey("upload", "doc123", "user456")).toBe("upload::doc123::user456");
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

  it("throws if a part contains the separator, to prevent cross-call collisions", () => {
    expect(() => idempotencyKey("a::b", "c")).toThrow(/::/);
  });

  it("does not let a part containing the separator silently collide with a different split", () => {
    // Without the guard, idempotencyKey("a::b", "c") would equal idempotencyKey("a", "b::c").
    expect(() => idempotencyKey("a", "b::c")).toThrow(/::/);
  });
});
