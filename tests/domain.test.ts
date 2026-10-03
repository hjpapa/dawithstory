import test from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/lib/domain";
test("CSV cells cannot execute spreadsheet formulas", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-cmd", "@SUM(1)", "\t=1"])
    assert.ok(csvCell(value).startsWith("\"'"));
});
test("CSV preserves quotes, Korean text, and line breaks", () => {
  assert.equal(csvCell('우리 "생각"\n함께'), '"우리 ""생각""\n함께"');
});
