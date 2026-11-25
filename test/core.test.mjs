import test from "node:test";
import assert from "node:assert/strict";
import { parseNumber, parseCsv, guessColumns, summarize, analyze, EXAMPLES, fmtPct } from "../dist/core.js";

const side = (o = {}) => ({ label: "", basis: "unknown", count: "", start: "", end: "", tz: "", filters: "", episodes: "", csv: { text: "", episodeCol: 0, countCol: 1 }, ...o });
const run = (a, b, c = {}) => analyze({ ours: side(a), theirs: side(b), contract: c });
const st = (r, id) => (r.checks.find((c) => c.id === id) || {}).status;

test("parseNumber accepts plain, comma, Indian and spaced numbers", () => {
  assert.equal(parseNumber("1234").value, 1234);
  assert.equal(parseNumber("1,234").value, 1234);
  assert.equal(parseNumber("1,23,456").value, 123456);
  assert.equal(parseNumber("12 345").value, 12345);
  assert.equal(parseNumber("12.5").value, 12.5);
  assert.equal(parseNumber("0").value, 0);
});
test("parseNumber rejects letters, negatives, blank", () => {
  assert.equal(parseNumber("12k").ok, false);
  assert.equal(parseNumber("1.2M").ok, false);
  assert.equal(parseNumber("-5").ok, false);
  assert.equal(parseNumber("").empty, true);
  assert.equal(parseNumber("1.2.3").ok, false);
});
test("parseCsv handles quotes, tabs, semicolons, BOM, CRLF", () => {
  const a = parseCsv('\uFEFFEpisode,Downloads\r\n"Ep 1, the start",100\r\n');
  assert.deepEqual(a.headers, ["Episode", "Downloads"]);
  assert.equal(a.rows[0][0], "Ep 1, the start");
  assert.equal(parseCsv("a\tb\n1\t2").rows[0][1], "2");
  assert.equal(parseCsv("a;b\n1;2").rows[0][1], "2");
  assert.equal(parseCsv("   ").empty, true);
});
test("parseCsv keeps escaped quotes", () => {
  assert.equal(parseCsv('t,n\n"He said ""hi""",5').rows[0][0], 'He said "hi"');
});
test("guessColumns suggests episode and count", () => {
  const g = guessColumns(parseCsv("Title,Plays,Date\nA,10,2026-01-01\nB,20,2026-01-02"));
  assert.equal(g.episodeCol, 0); assert.equal(g.countCol, 1);
});
test("guessColumns falls back to a numeric column", () => {
  const g = guessColumns(parseCsv("Show,X\nA,10\nB,20"));
  assert.equal(g.countCol, 1);
});
test("summarize sums and reports skipped rows with line numbers", () => {
  const s = summarize(parseCsv("Episode,Downloads\nA,10\nB,n/a\nC,5"), 0, 1);
  assert.equal(s.total, 15); assert.equal(s.counted, 2);
  assert.equal(s.skipped.length, 1); assert.equal(s.skipped[0].line, 3);
});
test("summarize flags a Total row", () => {
  const s = summarize(parseCsv("Episode,Downloads\nA,10\nTotal,10"), 0, 1);
  assert.equal(s.total, 20); assert.deepEqual(s.totalRowNames, ["Total"]);
});
test("empty input gives empty result, not a verdict", () => {
  const r = run();
  assert.equal(r.empty, true);
});
test("different bases are not like-for-like and gap says so", () => {
  const r = run({ basis: "download", count: "1000" }, { basis: "ad_delivered", count: "900" });
  assert.equal(st(r, "basis"), "review");
  assert.equal(r.gap.likeForLike, false);
  assert.equal(r.gap.diff, -100);
});
test("same basis gives like-for-like gap and percentages by both denominators", () => {
  const r = run({ basis: "download", count: "1000" }, { basis: "download", count: "700" });
  assert.equal(r.gap.likeForLike, true);
  assert.equal(Math.round(r.gap.pctOfOurs), -30);
  assert.equal(Math.round(r.gap.pctOfTheirs * 10) / 10, 42.9);
});
test("unknown basis is unknown, never same", () => {
  const r = run({ count: "10" }, { basis: "download", count: "10" });
  assert.equal(st(r, "basis"), "unknown");
  assert.equal(r.gap.likeForLike, false);
});
test("zero denominators give null percentages, no NaN", () => {
  const r = run({ basis: "download", count: "0" }, { basis: "download", count: "5" });
  assert.equal(r.gap.pctOfOurs, null);
  const r2 = run({ basis: "download", count: "5" }, { basis: "download", count: "0" });
  assert.equal(r2.gap.pctOfTheirs, null);
});
test("impressions-only label raises its own prompt", () => {
  const r = run({ basis: "impressions", count: "5" }, { basis: "download", count: "5" });
  assert.equal(st(r, "impr"), "review");
});
test("contract basis mismatch raises review per side", () => {
  const r = run({ basis: "download", count: "5" }, { basis: "ad_delivered", count: "5" }, { basis: "ad_delivered" });
  assert.equal(st(r, "contract_Your records"), "review");
  assert.equal(st(r, "contract_Their report"), "same");
});
test("no contract basis entered is a prompt to check the agreement", () => {
  const r = run({ basis: "download", count: "5" }, { basis: "download", count: "5" });
  assert.equal(st(r, "contract"), "unknown");
});
test("same dates is same; different dates reports overlap days", () => {
  let r = run({ start: "2026-10-01", end: "2026-10-31", count: "1" }, { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(st(r, "dates"), "same");
  r = run({ start: "2026-10-01", end: "2026-10-31", count: "1" }, { start: "2026-10-03", end: "2026-11-02" });
  assert.equal(st(r, "dates"), "review");
  assert.match(r.checks.find((c) => c.id === "dates").detail, /29 days overlap/);
});
test("non-overlapping windows say so", () => {
  const r = run({ start: "2026-09-01", end: "2026-09-30", count: "1" }, { start: "2026-10-01", end: "2026-10-31" });
  assert.match(r.checks.find((c) => c.id === "dates").detail, /do not overlap/);
});
test("invalid and impossible dates are caught", () => {
  let r = run({ start: "2026-10-31", end: "2026-10-01", count: "1" }, { start: "2026-10-01", end: "2026-10-31" });
  assert.equal(st(r, "dates"), "review");
  r = run({ start: "2026-02-30", end: "2026-03-01", count: "1" }, { start: "2026-02-01", end: "2026-02-28" });
  assert.equal(st(r, "dates"), "unknown");
});
test("leap day counted", () => {
  const r = run({ start: "2028-02-28", end: "2028-03-01", count: "1" }, { start: "2028-02-28", end: "2028-03-01" });
  assert.match(r.checks.find((c) => c.id === "dates").detail, /3 days/);
});
test("timezones: missing unknown, equal same, different review", () => {
  assert.equal(st(run({ count: "1" }, {}), "tz"), "unknown");
  assert.equal(st(run({ tz: "UTC", count: "1" }, { tz: " utc " }), "tz"), "same");
  assert.equal(st(run({ tz: "UTC", count: "1" }, { tz: "IST" }), "tz"), "review");
});
test("filters: wording differences flagged, not judged", () => {
  const r = run({ filters: "IAB filtered", count: "1" }, { filters: "bots removed" });
  assert.equal(st(r, "filters"), "review");
  assert.match(r.checks.find((c) => c.id === "filters").detail, /may or may not/);
});
test("episode lists compared by exact title ignoring case and spacing", () => {
  const r = run({ episodes: "Ep 1\nEp  2" }, { episodes: "ep 1\nEp 2\nEp 3" });
  assert.equal(st(r, "episodes"), "review");
  assert.match(r.checks.find((c) => c.id === "episodes").detail, /2 matched/);
  assert.match(r.checks.find((c) => c.id === "episodes").detail, /1 only in theirs/);
});
test("per-episode table built from CSV on both sides, sorted by size of difference", () => {
  const r = analyze(EXAMPLES.same.input);
  assert.equal(r.episodeTable.rows[0].name, "Ep 44 Recap"); // unmatched rows first
  assert.equal(r.episodeTable.rows[1].name, "Ep 42 Guest talk");
  assert.equal(r.episodeTable.rows[1].diff, -1500);
  const missing = r.episodeTable.rows.find((x) => x.name === "Ep 44 Recap");
  assert.equal(missing.note, "only in your records");
  assert.equal(missing.diff, null);
  assert.equal(r.episodeTable.comparable, true);
});
test("count falls back to CSV sum; typed total that disagrees warns and wins", () => {
  const csv = { text: "Episode,Downloads\nA,10\nB,5", episodeCol: 0, countCol: 1 };
  let r = run({ csv, basis: "download" }, { basis: "download", count: "20" });
  assert.equal(r.gap.ours, 15); assert.equal(r.gap.oursSource, "rows");
  r = run({ csv, basis: "download", count: "99" }, { basis: "download", count: "20" });
  assert.equal(r.gap.ours, 99);
  assert.ok(r.warnings.some((w) => /typed total/.test(w)));
});
test("unreadable typed total warns and is not used", () => {
  const r = run({ count: "12k", basis: "download" }, { count: "5", basis: "download" });
  assert.equal(r.gap, null);
  assert.ok(r.warnings.some((w) => /could not be read/.test(w)));
});
test("different-measures example flags basis, dates, tz, filters, episodes; no verdict words", () => {
  const r = analyze(EXAMPLES.different.input);
  ["basis", "dates", "tz", "episodes"].forEach((id) => assert.equal(st(r, id), "review", id));
  assert.equal(st(r, "filters"), "unknown");
  assert.equal(r.gap.likeForLike, false);
  const all = JSON.stringify(r).toLowerCase();
  ["fraud", "wrong", "owed", "refund", "underpaid", "breach"].forEach((w) => assert.ok(!all.includes(w), w));
});
test("note contains only entered facts and placeholders for the rest", () => {
  const r = analyze(EXAMPLES.same.input);
  assert.match(r.note, /\[name\]/);
  assert.match(r.note, /Host export \(synthetic\)/);
  assert.ok(!/different/.test(r.note.split("Could you confirm")[0]));
});
test("note asks only about things that are not confirmed the same", () => {
  const r = analyze(EXAMPLES.same.input);
  assert.ok(!/timezone used for day boundaries/.test(r.note));
  assert.ok(/episodes and ad positions/.test(r.note));
});
test("checklist always keeps raw files and adds a log request only when like-for-like", () => {
  let r = analyze(EXAMPLES.different.input);
  assert.ok(r.checklist.some((x) => /raw export/.test(x)));
  assert.ok(!r.checklist.some((x) => /log or a sample/.test(x)));
  r = analyze(EXAMPLES.same.input);
  assert.ok(r.checklist.some((x) => /log or a sample/.test(x)));
});
test("fmtPct formatting", () => {
  assert.equal(fmtPct(-30), "30%"); assert.equal(fmtPct(4.25), "4.3%"); assert.equal(fmtPct(0.04), "0%");
});
test("no object is mutated and results are deterministic", () => {
  const inp = JSON.parse(JSON.stringify(EXAMPLES.different.input));
  const a = analyze(inp), b = analyze(inp);
  assert.deepEqual(a, b);
  assert.deepEqual(inp, EXAMPLES.different.input);
});

test("duplicate episode titles in pasted rows raise a review prompt and are summed", () => {
  const r = run({ basis: "downloads", csv: { text: "Ep,N\nA,10\nA,5\nB,1", episodeCol: 0, countCol: 1 } }, { basis: "downloads", count: "16" });
  assert.ok(r.warnings.some((w) => /more than one row/.test(w)));
  assert.equal(r.gap.diff, 0);
});
test("reversed window dates are reviewed, not compared", () => {
  const r = run({ basis: "downloads", count: "5", start: "2026-10-31", end: "2026-10-01" }, { basis: "downloads", count: "5" });
  assert.equal(st(r, "dates"), "review");
});
test("different measures never report a like-for-like gap even when totals are equal", () => {
  const r = run({ basis: "downloads", count: "100" }, { basis: "ads_delivered", count: "100" });
  assert.equal(r.gap.likeForLike, false);
});

test("fuzz: 3000 random inputs never throw, never produce NaN or verdict words", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const bases = ["unknown", "download", "ad_delivered", "ad_confirmed", "platform_play", "listeners", "impressions"];
  const nums = ["", "0", "12", "1,234", "1,23,456", "12k", "-3", "1.2.3", "abc", "  7 ", "99999999999"];
  const dates = ["", "2026-10-01", "2026-10-31", "2026-02-30", "garbage", "2024-02-29"];
  const csvs = ["", "a", "Ep,N\nA,1\nA,2", 'Ep,N\n"x,y",5\n,\nTotal,6', "\uFEFFEp;N\r\nA;3", "Ep,N\nA", "a,b,c\n1,2,3\n4,5,6"];
  const verdict = /\b(fraud|wrong|owed|refund|cheat|liar|lying|guilty)\b/i;
  for (let i = 0; i < 3000; i++) {
    const s = () => side({ basis: pick(bases), count: pick(nums), start: pick(dates), end: pick(dates), tz: pick(["", "UTC", "IST"]), filters: pick(["", "IAB", "iab"]), episodes: pick(["", "A\nB", "a"]), csv: { text: pick(csvs), episodeCol: Math.floor(rnd() * 4) - 1, countCol: Math.floor(rnd() * 4) - 1 } });
    const r = analyze({ ours: s(), theirs: s(), contract: { basis: pick(bases), start: pick(dates), end: pick(dates) } });
    const j = JSON.stringify(r);
    const bad = /NaN|Infinity|undefined/.exec(j); assert.ok(!bad, bad && j.slice(Math.max(0, bad.index - 150), bad.index + 60));
    assert.ok(!verdict.test(j));
    if (r.gap && r.gap.likeForLike) assert.equal(r.checks.find((c) => c.id === "basis").status, "same");
  }
});
