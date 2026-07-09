import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(__dirname, "../src/shareResults.js"),
  "utf8",
);

describe("shareResults module", () => {
  it("exports canvas render and share helpers", () => {
    assert.match(src, /export function renderShareCanvas/);
    assert.match(src, /export async function shareTopResults/);
  });

  it("does not call html2canvas at runtime", () => {
    assert.doesNotMatch(src, /html2canvas\s*\(/);
    assert.doesNotMatch(src, /from\s+['\"]html2canvas['\"]/);
  });

  it("builds a downloadable PNG path", () => {
    assert.match(src, /image\/png/);
    assert.match(src, /download/);
  });
});
