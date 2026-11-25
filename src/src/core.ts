// Podcast sponsor numbers check: pure logic, no network, no storage.
// It lines up two sets of podcast delivery figures and raises review prompts.
// It never decides who is right and never combines different measures into one total.

export type BasisId = "unknown" | "download" | "ad_delivered" | "ad_confirmed" | "platform_play" | "listeners" | "impressions";
export interface Basis { id: BasisId; label: string; short: string }
export type Status = "same" | "review" | "unknown";
export type NumberResult = { ok: true; value: number } | { ok: false; empty?: boolean; reason: string };
export interface Csv { headers: string[]; rows: string[][]; delimiter: string; empty: boolean }
export interface CsvPick { text: string; episodeCol: number; countCol: number }
export interface Side { label: string; basis: BasisId; count: string; start: string; end: string; tz: string; filters: string; episodes: string; csv: CsvPick }
export interface Contract { basis: BasisId; start: string; end: string }
export interface Input { ours: Side; theirs: Side; contract: Contract }
export interface EpisodeRow { name: string; key: string; count: number; line: number }
export interface Skipped { line: number; name: string; value: string; reason: string }
export interface Summary { total: number; counted: number; perEpisode: EpisodeRow[]; skipped: Skipped[]; totalRowNames: string[] }
export interface Check { id: string; status: Status; title: string; detail: string }
export interface Gap { ours: number; theirs: number; diff: number; pctOfOurs: number | null; pctOfTheirs: number | null; likeForLike: boolean; oursSource: string; theirsSource: string }
export interface TableRow { name: string; ours: number | null; theirs: number | null; diff: number | null; note: string }
export interface EpisodeTable { rows: TableRow[]; comparable: boolean }
export interface Result { empty: boolean; checks: Check[]; warnings: string[]; gap: Gap | null; episodeTable: EpisodeTable | null; checklist: string[]; note: string; reviewCount?: number; unknownCount?: number }
type Range = { state: "none" | "partial" } | { state: "invalid"; a: number; b: number } | { state: "ok"; a: number; b: number; days: number };
interface Resolved { count: number | null; source: string; sum: Summary | null; warnings: string[]; basis: BasisId }
interface Ep { name: string; key: string; count: number | null }

export const BASES: Basis[] = [
  { id: "unknown", label: "Not sure what it counts", short: "unknown basis" },
  { id: "download", label: "Episode downloads (server requests)", short: "episode downloads" },
  { id: "ad_delivered", label: "Ads delivered (ad segment served)", short: "ads delivered" },
  { id: "ad_confirmed", label: "Confirmed ad plays (player signal)", short: "confirmed ad plays" },
  { id: "platform_play", label: "Platform plays or streams (Apple, Spotify, YouTube)", short: "platform plays" },
  { id: "listeners", label: "Listeners (audience estimate)", short: "listeners" },
  { id: "impressions", label: "Labelled only 'impressions' (no definition given)", short: "impressions (no definition given)" },
];

export function basisLabel(id: string) {
  const b = BASES.find((x) => x.id === id);
  return b ? b.short : "unknown basis";
}

export function norm(s: unknown): string {
  return String(s == null ? "" : s).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
}

// ---- numbers -------------------------------------------------------------
// Accepts 1234, 1,234, 1,23,456, 1 234, 1234.5. Rejects 12k, 1.2M, text, negatives.
export function parseNumber(raw: unknown): NumberResult {
  if (raw == null) return { ok: false, empty: true, reason: "empty" };
  let s = String(raw).trim();
  if (s === "") return { ok: false, empty: true, reason: "empty" };
  if (/^[-\u2212]/.test(s)) return { ok: false, reason: "negative" };
  if (/[a-z]/i.test(s)) return { ok: false, reason: "has letters" };
  s = s.replace(/[\s\u00a0\u202f]/g, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: "not a plain number" };
  return { ok: true, value: Number(s) };
}

// ---- CSV -----------------------------------------------------------------
export function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ",": 0, "\t": 0, ";": 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  let best = ",";
  for (const d of Object.keys(counts)) if (counts[d] > counts[best]) best = d;
  return best;
}

export function parseCsv(text: unknown): Csv {
  const src = String(text || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!src.trim()) return { headers: [], rows: [], delimiter: ",", empty: true };
  const firstLine = src.split("\n").find((l) => l.trim() !== "") || "";
  const delim = detectDelimiter(firstLine);
  const out: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  row.push(cur);
  out.push(row);
  const rows = out.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!rows.length) return { headers: [], rows: [], delimiter: delim, empty: true };
  const headers = rows[0].map((h, i) => (String(h).trim() || "Column " + (i + 1)));
  return { headers, rows: rows.slice(1), delimiter: delim, empty: false };
}

// Guess which columns hold the episode name and the count. Only a suggestion.
export function guessColumns(csv: Csv): { episodeCol: number; countCol: number } {
  const h = csv.headers.map(norm);
  let ep = h.findIndex((x) => /(episode|title|name)/.test(x));
  let cnt = h.findIndex((x) => /(download|plays|streams|listen|impression|count|total|delivered)/.test(x));
  if (cnt === ep) cnt = -1;
  if (ep < 0) ep = 0;
  if (cnt < 0) {
    // first column, other than the episode column, whose cells are mostly numbers
    for (let c = 0; c < csv.headers.length; c++) {
      if (c === ep) continue;
      const cells = csv.rows.map((r) => r[c]).filter((v) => v != null && String(v).trim() !== "");
      if (cells.length && cells.filter((v) => parseNumber(v).ok).length / cells.length >= 0.8) { cnt = c; break; }
    }
  }
  return { episodeCol: ep, countCol: cnt };
}

// Sum a count column. Rows are not dropped silently: skipped rows are returned.
export function summarize(csv: Csv, episodeCol: number, countCol: number): Summary {
  const perEpisode: EpisodeRow[] = [];
  const skipped: Skipped[] = [];
  let total = 0, counted = 0;
  csv.rows.forEach((r, i) => {
    const name = episodeCol >= 0 && episodeCol < r.length ? String(r[episodeCol]).trim() : "";
    const p = parseNumber(countCol >= 0 ? r[countCol] : "");
    if (!p.ok) {
      // a trailing "Total" style row with no number is not worth a warning; an unparseable number is
      if (!(p.empty && name === "")) skipped.push({ line: i + 2, name, value: countCol >= 0 ? String(r[countCol] == null ? "" : r[countCol]) : "", reason: p.reason });
      return;
    }
    total += p.value;
    counted++;
    perEpisode.push({ name, key: norm(name), count: p.value, line: i + 2 });
  });
  const totalRows = perEpisode.filter((e) => /^(grand )?total(s)?$/.test(e.key) || /^all (episodes|time)$/.test(e.key));
  return { total, counted, perEpisode, skipped, totalRowNames: totalRows.map((t) => t.name) };
}

// ---- dates ---------------------------------------------------------------
export function parseDay(s: unknown): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return t;
}
const DAY = 86400000;
export function dayCount(a: number, b: number) { return Math.round((b - a) / DAY) + 1; }
export function fmtDay(t: number) {
  const d = new Date(t);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return d.getUTCDate() + " " + mo + " " + d.getUTCFullYear();
}
export function range(side: { start: string; end: string }): Range {
  const a = parseDay(side.start), b = parseDay(side.end);
  if (a == null && b == null) return { state: "none" };
  if (a == null || b == null) return { state: "partial" };
  if (b < a) return { state: "invalid", a, b };
  return { state: "ok", a, b, days: dayCount(a, b) };
}

// ---- formatting ----------------------------------------------------------
export function fmtInt(n: number) {
  // Indian digit grouping reads naturally for this user; plain grouping is also fine. Use plain en-US.
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
export function fmtPct(x: number) {
  const a = Math.abs(x);
  return (a >= 10 ? a.toFixed(0) : a.toFixed(1)).replace(/\.0$/, "") + "%";
}

export function episodeKeys(side: Side, sum: Summary | null): Ep[] {
  // Episode list from the CSV rows if present, otherwise from the typed list (one per line).
  if (sum) {
    return sum.perEpisode.filter((e) => e.key && !/^(grand )?total(s)?$/.test(e.key)).map((e) => ({ name: e.name, key: e.key, count: e.count }));
  }
  return String(side.episodes || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l, key: norm(l), count: null }));
}

// ---- main analysis -------------------------------------------------------
// side: {label, basis, count, start, end, tz, filters, episodes, csv:{text, episodeCol, countCol}}
export function resolveSide(side: Side, who: string): Resolved {
  const warnings: string[] = [];
  let sum: Summary | null = null;
  if (side.csv && String(side.csv.text || "").trim()) {
    const csv = parseCsv(side.csv.text);
    if (!csv.empty && side.csv.countCol >= 0) {
      sum = summarize(csv, side.csv.episodeCol, side.csv.countCol);
    }
  }
  const typed = parseNumber(side.count);
  let count: number | null = null, source = "none";
  if (typed.ok) { count = typed.value; source = "typed"; }
  else if (!typed.empty) warnings.push(who + ": the total you typed could not be read as a plain number (" + typed.reason + ").");
  if (sum && count == null && sum.counted > 0) { count = sum.total; source = "rows"; }
  if (sum && typed.ok && sum.counted > 0 && sum.total !== typed.value) {
    warnings.push(who + ": the typed total (" + fmtInt(typed.value) + ") is not the sum of the pasted rows (" + fmtInt(sum.total) + "). The typed total is used. Check which is right.");
  }
  if (sum) {
    const seen: Record<string, number> = {}, dups: string[] = [];
    sum.perEpisode.forEach((e) => { if (e.key && seen[e.key] && dups.indexOf(e.name) < 0) dups.push(e.name); seen[e.key] = 1; });
    if (dups.length) warnings.push(who + ": " + dups.length + " episode title" + (dups.length === 1 ? " appears" : "s appear") + " on more than one row (first: " + dups[0] + "). Rows with the same title are added together in the per-episode table. Check whether they are one episode or two.");
  }
  if (sum && sum.skipped.length) {
    warnings.push(who + ": " + sum.skipped.length + " pasted row" + (sum.skipped.length === 1 ? " was" : "s were") + " skipped because the count could not be read (first: line " + sum.skipped[0].line + ").");
  }
  if (sum && sum.totalRowNames.length) {
    warnings.push(who + ": a row named \"" + sum.totalRowNames[0] + "\" is in the pasted rows. If it is a grand total it is counted on top of the episodes. Remove it or check the sum.");
  }
  return { count, source, sum, warnings, basis: side.basis || "unknown" };
}

export function analyze(input: Input): Result {
  const { ours, theirs, contract } = input;
  const A = resolveSide(ours, "Your records");
  const B = resolveSide(theirs, "Their report");
  const checks: Check[] = [];
  const add = (id: string, status: Status, title: string, detail: string) => checks.push({ id, status, title, detail });

  const entered = A.count != null || B.count != null || String(ours.episodes || "").trim() || String(theirs.episodes || "").trim() || A.sum || B.sum;
  if (!entered) return { empty: true, checks: [], warnings: [], gap: null, episodeTable: null, checklist: [], note: "" };

  // 1. Same measure?
  const ba = A.basis, bb = B.basis;
  const aLab = basisLabel(ba), bLab = basisLabel(bb);
  if (ba === "unknown" || bb === "unknown") {
    add("basis", "unknown", "What each number counts is not settled",
      (ba === "unknown" ? "Your records" : "Their report") + " is marked as not sure what it counts. Ask for the definition before comparing the totals.");
  } else if (ba !== bb) {
    add("basis", "review", "The two numbers count different things",
      "Yours counts " + aLab + ". Theirs counts " + bLab + ". A gap between these is expected and is not by itself a discrepancy. They should not be added or averaged.");
  } else {
    add("basis", "same", "Both are marked as counting " + aLab,
      "That is only what you selected. Confirm it against each report's own definition.");
  }
  if (ba === "impressions" || bb === "impressions") {
    add("impr", "review", "A figure labelled only 'impressions' needs a definition",
      "Impressions can mean downloads, ads delivered or something else. Ask which event is counted before using it.");
  }

  // 2. Contract basis
  if (contract.basis && contract.basis !== "unknown") {
    const cLab = basisLabel(contract.basis);
    ([["Your records", ba, aLab], ["Their report", bb, bLab]] as [string, BasisId, string][]).forEach(([who, b, lab]) => {
      if (b === "unknown") add("contract_" + who, "unknown", who + " cannot be matched to the agreement yet", "The agreement names " + cLab + ", and this side's basis is unknown.");
      else if (b !== contract.basis) add("contract_" + who, "review", who + " counts " + lab + ", the agreement names " + cLab, "Only the measure the agreement names is the one to compare. Confirm the wording in the agreement yourself.");
      else add("contract_" + who, "same", who + " matches the measure you entered from the agreement", "Based on what you entered, not on reading the agreement.");
    });
  } else {
    add("contract", "unknown", "Which measure the agreement names is not entered",
      "Check the sponsorship agreement or insertion order for the counted measure, the reporting window and which source is authoritative. This tool does not read it.");
  }

  // 3. Dates
  const ra = range(ours), rb = range(theirs);
  const dateLine = (r: { a: number; b: number; days: number }) => fmtDay(r.a) + " to " + fmtDay(r.b) + " (" + r.days + " day" + (r.days === 1 ? "" : "s") + ")";
  if (ra.state === "invalid" || rb.state === "invalid") {
    add("dates", "review", "A date range ends before it starts", "Fix the dates entered before comparing.");
  } else if (ra.state !== "ok" || rb.state !== "ok") {
    add("dates", "unknown", "A reporting window is missing",
      "Enter the start and end date for " + (ra.state !== "ok" && rb.state !== "ok" ? "both sides" : ra.state !== "ok" ? "your records" : "their report") + ". Totals over different windows are not comparable.");
  } else if (ra.a === rb.a && ra.b === rb.b) {
    add("dates", "same", "Same reporting window entered", dateLine(ra) + ".");
  } else {
    const lo = Math.max(ra.a, rb.a), hi = Math.min(ra.b, rb.b);
    const overlap = hi >= lo ? dayCount(lo, hi) : 0;
    add("dates", "review", "The reporting windows differ",
      "Yours: " + dateLine(ra) + ". Theirs: " + dateLine(rb) + ". " + (overlap ? overlap + " day" + (overlap === 1 ? "" : "s") + " overlap." : "They do not overlap.") +
      " " + Math.abs(ra.days - rb.days) + " day" + (Math.abs(ra.days - rb.days) === 1 ? "" : "s") + " difference in length.");
  }
  if (contract.start || contract.end) {
    const rc = range(contract);
    if (rc.state === "ok") {
      ([["Your records", ra], ["Their report", rb]] as [string, Range][]).forEach(([who, r]) => {
        if (r.state === "ok" && (r.a !== rc.a || r.b !== rc.b)) add("cwin_" + who, "review", who + " window differs from the agreement window entered", "Agreement: " + dateLine(rc) + ". " + who + ": " + dateLine(r) + ".");
      });
    }
  }

  // 4. Timezone
  const tza = norm(ours.tz), tzb = norm(theirs.tz);
  if (!tza || !tzb) add("tz", "unknown", "Reporting timezone not entered for " + (!tza && !tzb ? "either side" : !tza ? "your records" : "their report"), "Day boundaries depend on the timezone. It affects counts near the first and last day of the window, not the middle.");
  else if (tza !== tzb) add("tz", "review", "Different timezones entered", "Yours: " + ours.tz.trim() + ". Theirs: " + theirs.tz.trim() + ". The first and last day can hold different events. Ask for the same cut-off.");
  else add("tz", "same", "Same timezone entered", ours.tz.trim() + ".");

  // 5. Filters
  const fa = norm(ours.filters), fb = norm(theirs.filters);
  if (!fa && !fb) add("filters", "unknown", "Filtering rules not entered", "Downloads can be filtered for bots, repeats, minimum time served or location. Neither side's rule is recorded here.");
  else if (!fa || !fb) add("filters", "unknown", "Filtering rules entered for one side only", (fa ? "Theirs" : "Yours") + " is blank. Ask for it.");
  else if (fa !== fb) add("filters", "review", "Filtering rules are worded differently", "Yours: \"" + ours.filters.trim() + "\". Theirs: \"" + theirs.filters.trim() + "\". They may or may not be the same rule.");
  else add("filters", "same", "Same filtering wording entered", "\"" + ours.filters.trim() + "\".");

  // 6. Episodes
  const ea = episodeKeys(ours, A.sum), eb = episodeKeys(theirs, B.sum);
  let episodeTable: EpisodeTable | null = null;
  if (!ea.length || !eb.length) {
    add("episodes", "unknown", "Episode lists not entered for " + (!ea.length && !eb.length ? "either side" : !ea.length ? "your records" : "their report"), "Check the same episodes and ad positions are in scope on both sides.");
  } else {
    const ka = new Map(ea.map((e) => [e.key, e])), kb = new Map(eb.map((e) => [e.key, e]));
    const onlyA = ea.filter((e) => !kb.has(e.key)), onlyB = eb.filter((e) => !ka.has(e.key));
    const both = ea.filter((e) => kb.has(e.key));
    if (!onlyA.length && !onlyB.length) add("episodes", "same", "Same " + both.length + " episode" + (both.length === 1 ? "" : "s") + " named on both sides", "Matched by exact title, ignoring case and spacing.");
    else add("episodes", "review", "The episode lists do not match",
      both.length + " matched. " + onlyA.length + " only in your records" + (onlyA.length ? " (" + onlyA.slice(0, 3).map((e) => e.name).join("; ") + (onlyA.length > 3 ? "; ..." : "") + ")" : "") + ". " +
      onlyB.length + " only in theirs" + (onlyB.length ? " (" + onlyB.slice(0, 3).map((e) => e.name).join("; ") + (onlyB.length > 3 ? "; ..." : "") + ")" : "") + ". An unmatched title may be the same episode named differently.");
    if (ea.every((e) => e.count != null) && eb.every((e) => e.count != null)) {
      const rows: TableRow[] = [];
      const seen = new Set<string>();
      ea.forEach((e) => { seen.add(e.key); const o = kb.get(e.key); rows.push({ name: e.name, ours: e.count, theirs: o ? o.count : null, diff: null, note: "" }); });
      eb.forEach((e) => { if (!seen.has(e.key)) rows.push({ name: e.name, ours: null, theirs: e.count, diff: null, note: "" }); });
      rows.forEach((r) => {
        r.diff = r.ours != null && r.theirs != null ? r.theirs - r.ours : null;
        r.note = r.ours == null ? "only in their report" : r.theirs == null ? "only in your records" : r.diff === 0 ? "equal" : "differs";
      });
      rows.sort((x, y) => (y.diff == null ? Infinity : Math.abs(y.diff)) - (x.diff == null ? Infinity : Math.abs(x.diff)));
      episodeTable = { rows, comparable: ba === bb && ba !== "unknown" };
    }
  }

  // gap
  let gap: Gap | null = null;
  if (A.count != null && B.count != null) {
    const diff = B.count - A.count;
    const likeForLike = ba === bb && ba !== "unknown";
    gap = {
      ours: A.count, theirs: B.count, diff,
      pctOfOurs: A.count > 0 ? (diff / A.count) * 100 : null,
      pctOfTheirs: B.count > 0 ? (-diff / B.count) * 100 : null,
      likeForLike,
      oursSource: A.source, theirsSource: B.source,
    };
  }

  const reviewCount = checks.filter((c) => c.status === "review").length;
  const unknownCount = checks.filter((c) => c.status === "unknown").length;
  const checklist = buildChecklist(checks, gap);
  const note = buildNote(ours, theirs, ra, rb, A, B, checks);
  return { empty: false, checks, warnings: A.warnings.concat(B.warnings), gap, episodeTable, checklist, note, reviewCount, unknownCount };
}

export function buildChecklist(checks: Check[], gap: Gap | null): string[] {
  const out: string[] = [];
  const has = (id: string, st?: Status) => checks.some((c) => (c.id === id || c.id.indexOf(id) === 0) && (!st || c.status === st));
  if (has("basis", "unknown") || has("basis", "review") || has("impr")) out.push("Ask the other side to name the exact measure behind their figure and attach the definition their report uses.");
  if (has("contract")) out.push("Find the measure, reporting window and authoritative source in the signed agreement or insertion order. Quote the wording.");
  if (has("dates")) out.push("Agree one start and end date and re-export both reports for exactly that window.");
  if (has("tz")) out.push("Agree one timezone cut-off for day boundaries.");
  if (has("filters")) out.push("Ask what filtering was applied (bots, repeat requests, minimum time served, location) and write down yours.");
  if (has("episodes")) out.push("List the same episodes and ad positions on both sides. Check renamed or re-uploaded episodes.");
  out.push("Keep your raw export files unedited, with the export date and the report names, before any call.");
  if (gap && gap.likeForLike) out.push("If the basis, window, timezone and filters match and the gap remains, ask for a log or a sample of the underlying records for a few episodes.");
  return out;
}

export function buildNote(ours: Side, theirs: Side, ra: Range, rb: Range, A: Resolved, B: Resolved, checks: Check[]): string {
  const lines: string[] = [];
  const ol = (ours.label || "our host report").trim(), tl = (theirs.label || "your report").trim();
  lines.push("Hi [name],");
  lines.push("");
  lines.push("I am comparing the delivery numbers for [campaign / show]. I want to make sure we are counting the same thing before we talk about any difference.");
  lines.push("");
  lines.push("What I have:");
  const mine: string[] = [];
  if (A.count != null) mine.push(fmtInt(A.count) + (A.basis !== "unknown" ? " " + basisLabel(A.basis) : ""));
  if (ra.state === "ok") mine.push(fmtDay(ra.a) + " to " + fmtDay(ra.b));
  if (String(ours.tz || "").trim()) mine.push("timezone " + ours.tz.trim());
  if (String(ours.filters || "").trim()) mine.push("filters: " + ours.filters.trim());
  lines.push("- " + ol + ": " + (mine.length ? mine.join("; ") : "[figure and definition]") + ".");
  const theirsBits: string[] = [];
  if (B.count != null) theirsBits.push(fmtInt(B.count) + (B.basis !== "unknown" ? " " + basisLabel(B.basis) : ""));
  if (rb.state === "ok") theirsBits.push(fmtDay(rb.a) + " to " + fmtDay(rb.b));
  lines.push("- " + tl + ": " + (theirsBits.length ? theirsBits.join("; ") : "[figure as reported]") + ".");
  lines.push("");
  const asks: string[] = [];
  if (checks.some((c) => (c.id === "basis" || c.id === "impr") && c.status !== "same")) asks.push("exactly what each figure counts (downloads, ads delivered, confirmed plays or something else)");
  if (checks.some((c) => c.id === "dates" && c.status !== "same")) asks.push("the exact start and end dates your report covers");
  if (checks.some((c) => c.id === "tz" && c.status !== "same")) asks.push("the timezone used for day boundaries");
  if (checks.some((c) => c.id === "filters" && c.status !== "same")) asks.push("any filtering applied (bots, repeats, minimum time served, location)");
  if (checks.some((c) => c.id === "episodes" && c.status !== "same")) asks.push("the list of episodes and ad positions included");
  if (asks.length) {
    lines.push("Could you confirm:");
    asks.forEach((a) => lines.push("- " + a));
    lines.push("");
  }
  lines.push("If it helps, I can send my export for the same window. Once we agree on the measure, window and cut-off, we can compare the numbers properly.");
  lines.push("");
  lines.push("Thanks,");
  lines.push("[your name]");
  return lines.join("\n");
}

// ---- synthetic examples (invented, for trying the tool only) ----------------
export const EXAMPLES: Record<"different" | "same", { name: string; blurb: string; input: Input }> = {
  different: {
    name: "Different measures",
    blurb: "Invented numbers. Host downloads against a sponsor's 'ads delivered', with different windows.",
    input: {
      ours: { label: "Host export (synthetic)", basis: "download", count: "", start: "2026-10-01", end: "2026-10-31", tz: "UTC", filters: "bots and repeat requests removed", episodes: "",
        csv: { text: "Episode,Downloads\nEp 41 Launch,5200\nEp 42 Guest talk,4800\nEp 43 Q&A,3100\nEp 44 Recap,2600", episodeCol: 0, countCol: 1 } },
      theirs: { label: "Sponsor report (synthetic)", basis: "ad_delivered", count: "13200", start: "2026-10-03", end: "2026-11-02", tz: "America/New_York", filters: "", episodes: "Ep 41 Launch\nEp 42 Guest talk\nEp 43 Q&A", csv: { text: "", episodeCol: 0, countCol: 1 } },
      contract: { basis: "ad_delivered", start: "2026-10-01", end: "2026-10-31" },
    },
  },
  same: {
    name: "Same measure, one gap",
    blurb: "Invented numbers. Same measure and window, one episode counts differently, one is missing.",
    input: {
      ours: { label: "Host export (synthetic)", basis: "download", count: "", start: "2026-10-01", end: "2026-10-31", tz: "UTC", filters: "IAB filtered", episodes: "",
        csv: { text: "Episode,Downloads\nEp 41 Launch,5200\nEp 42 Guest talk,4800\nEp 43 Q&A,3100\nEp 44 Recap,2600", episodeCol: 0, countCol: 1 } },
      theirs: { label: "Sponsor tracker (synthetic)", basis: "download", count: "", start: "2026-10-01", end: "2026-10-31", tz: "UTC", filters: "IAB filtered", episodes: "",
        csv: { text: "Episode,Downloads\nEp 41 Launch,5150\nEp 42 Guest talk,3300\nEp 43 Q&A,3100", episodeCol: 0, countCol: 1 } },
      contract: { basis: "download", start: "2026-10-01", end: "2026-10-31" },
    },
  },
};
