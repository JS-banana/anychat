import { describe, it, expect } from "vitest";
import { resolveNextVersion } from "../../scripts/ci/next-version.mjs";

describe("resolveNextVersion", () => {
  it("uses tauri.conf.json version when it differs from latest tag", () => {
    expect(resolveNextVersion("0.2.0", "v0.1.9")).toBe("0.2.0");
  });

  it("patch bumps when tauri.conf.json matches latest tag", () => {
    expect(resolveNextVersion("0.1.9", "v0.1.9")).toBe("0.1.10");
  });

  it("handles no tags (null) by using tauri.conf.json version", () => {
    expect(resolveNextVersion("0.3.0", null)).toBe("0.3.0");
  });
});
