import { describe, it, expect } from "vitest";
import { VCOIN_CLIENT_VERSION } from "./index";

describe("package scaffold", () => {
  it("exports a version string matching package.json", () => {
    expect(VCOIN_CLIENT_VERSION).toBe("0.1.0");
  });
});
