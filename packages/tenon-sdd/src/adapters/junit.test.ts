import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJunit, readReports, removeReports } from "./junit.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures/junit", name), "utf8");
const summary = (xml: string) => parseJunit(xml).map((testCase) => `${testCase.result} ${testCase.name}`);

describe("parseJunit", () => {
  it("reads Vitest, with entities and a skipped test", () => {
    expect(summary(fixture("vitest.xml"))).toEqual(["passed sort > newest first [favorites-sorting-us1-s1]", "failed sort > ties by name", "skipped sort > later"]);
    expect(parseJunit(fixture("vitest.xml"))[0].className).toBe("src/sort.test.ts");
  });

  it("reads Jest", () => {
    expect(summary(fixture("jest.xml"))).toEqual(["passed sort newest first", "failed sort ties"]);
  });

  it("reads Playwright, with a <testcase> text inside CDATA", () => {
    expect(summary(fixture("playwright.xml"))).toEqual(["passed favorites-sorting-us2-s1 newest at top", "failed favorites-sorting-us1-s1 sort by date"]);
  });

  it("reads pytest, with self-closing test cases and an error", () => {
    expect(summary(fixture("pytest.xml"))).toEqual(["passed test_newest_first", "skipped test_skip", "failed test_error"]);
  });

  it("reads Maestro", () => {
    expect(summary(fixture("maestro.xml"))).toEqual(["passed favorites-sorting-us1-s1", "failed favorites-sorting-us2-s1"]);
  });

  it("passes when <system-out> CDATA contains <error>", () => {
    const xml = `<testsuites><testsuite><testcase name="test1" classname="Test"><system-out><![CDATA[error <error code=1>]]></system-out></testcase></testsuite></testsuites>`;
    expect(summary(xml)).toEqual(["passed test1"]);
  });

  it("one case when <failure> CDATA contains </testcase><testcase name=\"ghost\">", () => {
    const xml = `<testsuites><testsuite><testcase name="real" classname="Test"><failure><![CDATA[failed </testcase><testcase name="ghost" classname="g">]]></failure></testcase></testsuite></testsuites>`;
    const cases = parseJunit(xml);
    expect(cases).toHaveLength(1);
    expect(cases[0].name).toBe("real");
    expect(cases[0].result).toBe("failed");
  });

  it("ignores <testcase> inside XML comment", () => {
    const xml = `<testsuites><testsuite><!-- <testcase name="commented" classname="C"></testcase> --><testcase name="real" classname="Test"></testcase></testsuite></testsuites>`;
    expect(summary(xml)).toEqual(["passed real"]);
  });
});

describe("readReports and removeReports", () => {
  it("read only the files that match, name globs with no file, and delete reports", async () => {
    const root = mkdtempSync(join(tmpdir(), "tenon-sdd-"));
    mkdirSync(join(root, "reports/sub"), { recursive: true });
    writeFileSync(join(root, "reports/a.xml"), fixture("jest.xml"));
    writeFileSync(join(root, "reports/sub/b.xml"), fixture("maestro.xml"));
    const result = await readReports(root, ["reports/*.xml", "out/*.xml"]);
    expect(result.cases).toHaveLength(2);
    expect(result.missing).toEqual(["out/*.xml"]);
    await removeReports(root, ["reports/*.xml"]);
    expect(existsSync(join(root, "reports/a.xml"))).toBe(false);
    expect(existsSync(join(root, "reports/sub/b.xml"))).toBe(true);
  });

  it("rejects .. globs and treats them as missing, does not delete outside files", async () => {
    const root = mkdtempSync(join(tmpdir(), "tenon-sdd-"));
    const outside = mkdtempSync(join(tmpdir(), "tenon-sdd-outside-"));
    writeFileSync(join(outside, "outside.xml"), fixture("jest.xml"));
    const result = await readReports(root, ["../*.xml"]);
    expect(result.cases).toHaveLength(0);
    expect(result.missing).toEqual(["../*.xml"]);
    await removeReports(root, ["../tenon-sdd-outside-*/*.xml"]);
    expect(existsSync(join(outside, "outside.xml"))).toBe(true);
  });
});
