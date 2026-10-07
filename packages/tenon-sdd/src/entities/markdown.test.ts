import { describe, expect, it } from "vitest";
import { hasSection, upsertSection } from "./markdown.js";

const TEXT = "# Outcome\n\n## Delivered\n- US1\n\n## Review\nold\n\n## Left open\n- none\n";

describe("upsertSection", () => {
  it("replaces a section up to the next heading", () => {
    expect(upsertSection(TEXT, "Review", "No findings.")).toBe("# Outcome\n\n## Delivered\n- US1\n\n## Review\nNo findings.\n\n## Left open\n- none\n");
  });

  it("adds a missing section at the end", () => {
    expect(upsertSection("# Outcome\n\n## Delivered\n- US1\n", "ID map", "- none")).toBe("# Outcome\n\n## Delivered\n- US1\n\n## ID map\n- none\n");
  });
});

describe("hasSection", () => {
  it("finds a heading of level 2", () => {
    expect(hasSection(TEXT, "Delivered")).toBe(true);
    expect(hasSection(TEXT, "Evidence")).toBe(false);
  });
});
