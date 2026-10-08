import { globBase } from "./glob.js";
import { parsed, type ParseResult } from "./result.js";

export type Rules = {
  fullTier: string;
  junitReports: string[];
  fastTier: string | undefined;
  testFiles: string[];
  mutation: string | undefined;
  innerTdd: "optional" | "required";
};

const COMMAND_LINE = /^- ([A-Za-z ]+): (.+)$/;

/** Parse the Commands section of sdd/rules.md. All other text in the file is prose. */
export function parseRules(markdown: string): ParseResult<Rules> {
  const values = commandValues(markdown);
  const errors: string[] = [];
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) errors.push(`rules.md: the Commands section needs the line "- ${key}: …".`);
    return value ?? "";
  };
  const innerTdd = values.get("Inner TDD") ?? "optional";
  if (innerTdd !== "optional" && innerTdd !== "required") errors.push(`rules.md: "Inner TDD" must be optional or required, not "${innerTdd}".`);
  const mutation = values.get("Mutation");
  const rules: Rules = {
    fullTier: required("Full tier"),
    junitReports: list(required("JUnit reports")),
    fastTier: values.get("Fast tier"),
    testFiles: list(required("Test files")),
    mutation: mutation && mutation.toLowerCase() !== "none" ? mutation : undefined,
    innerTdd: innerTdd === "required" ? "required" : "optional",
  };
  for (const glob of rules.junitReports.filter((report) => globBase(report) === "")) {
    errors.push(`rules.md: the JUnit report glob "${glob}" must start with a folder, for example reports/*.xml.`);
  }
  return parsed(rules, errors);
}

function commandValues(markdown: string): Map<string, string> {
  const values = new Map<string, string>();
  let isCommands = false;
  for (const line of markdown.split(/\r?\n/).map((text) => text.trim())) {
    if (line.startsWith("#")) isCommands = line === "## Commands";
    const match = isCommands ? COMMAND_LINE.exec(line) : null;
    if (match) values.set(match[1].trim(), match[2].trim());
  }
  return values;
}

/** Globs match paths from the project root, which have no leading "./". */
function list(value: string): string[] {
  return value.split(",").map((item) => item.trim().replace(/^\.\//, "")).filter(Boolean);
}
