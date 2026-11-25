import test from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES } from "../dist/core.js";
import { renderResult, esc, basisButtons, columnPickers } from "../dist/view.js";
import { parseCsv } from "../dist/core.js";

const copy = (o) => JSON.parse(JSON.stringify(o));
test("esc escapes html", () => { assert.equal(esc('<b>"x" & \'y\'</b>'), "&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;"); });
test("user text cannot inject markup", () => {
  const s = copy(EXAMPLES.same.input); s.ours.label = '<img src=x onerror=alert(1)>'; s.ours.filters = "<script>1</script>";
  const h = renderResult(s);
  assert.ok(!/<img|<script/i.test(h.replace(/<textarea[\s\S]*?<\/textarea>/g, "")));
});
test("different-measures example renders the not-like-for-like warning and no NaN", () => {
  const h = renderResult(copy(EXAMPLES.different.input));
  assert.match(h, /Not a like-for-like gap/); assert.match(h, /Example data/); assert.ok(!/NaN|undefined|Infinity/.test(h));
});
test("same-measure example has no like-for-like warning and shows a per-episode table", () => {
  const h = renderResult(copy(EXAMPLES.same.input));
  assert.ok(!/Not a like-for-like gap/.test(h)); assert.match(h, /Per episode/);
});
test("empty input renders the empty state", () => {
  const s = copy(EXAMPLES.same.input); for (const k of ["ours", "theirs"]) { s[k].count = ""; s[k].csv.text = ""; }
  assert.match(renderResult(s), /Nothing to compare yet/);
});
test("copy button and selectable note are present", () => {
  const h = renderResult(copy(EXAMPLES.same.input));
  assert.match(h, /id="copy"/); assert.match(h, /<textarea id="note"/);
});
test("basis buttons mark exactly one pressed; column pickers appear only with csv", () => {
  assert.equal((basisButtons("ours", "download").match(/aria-pressed="true"/g) || []).length, 1);
  assert.equal(columnPickers({ csv: { episodeCol: 0, countCol: 1 } }, parseCsv("")), "");
  assert.match(columnPickers({ csv: { episodeCol: 0, countCol: 1 } }, parseCsv("Ep,N\nA,1")), /Which column is the count/);
});
