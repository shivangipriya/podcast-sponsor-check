import { EXAMPLES, parseCsv, guessColumns } from "./core.js";
import type { Contract, Input, Side } from "./core.js";
import { renderResult, basisButtons, columnPickers } from "./view.js";

type Key = "ours" | "theirs" | "contract";

const blankSide = (): Side => ({ label: "", basis: "unknown", count: "", start: "", end: "", tz: "", filters: "", episodes: "", csv: { text: "", episodeCol: 0, countCol: -1 } });
const blank = (): Input => ({ ours: blankSide(), theirs: blankSide(), contract: { basis: "unknown", start: "", end: "" } });
const copy = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
let state: Input = copy(EXAMPLES.different.input);

function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error("Missing element: " + sel);
  return el;
}

function sideHtml(key: string, title: string): string {
  return `<section class="group" data-side="${key}"><h2>${title}</h2>
<label class="label">Name of this report<input class="input" data-field="label"></label>
<p class="label">What does this number count?</p><div class="choices" data-basis></div>
<label class="label">Total figure (optional if you paste rows below)<input class="input" data-field="count" inputmode="numeric"></label>
<div class="dates"><label class="label">Window starts<input class="input" type="date" data-field="start"></label><label class="label">Window ends<input class="input" type="date" data-field="end"></label></div>
<label class="label">Timezone used for days (for example UTC or IST)<input class="input" data-field="tz"></label>
<label class="label">Filtering rules, in the report's own words<input class="input" data-field="filters"></label>
<label class="label">Paste the per-episode rows from the export (CSV, header row first)<textarea class="text" data-field="csv" spellcheck="false" placeholder="Episode,Downloads&#10;Ep 1,1200"></textarea></label>
<div data-columns></div>
<label class="label" data-eps>Or list the episodes in scope, one per line<textarea class="text short" data-field="episodes" spellcheck="false"></textarea></label></section>`;
}

function build(): void {
  $("#app").innerHTML = `
<header><h1>Check podcast sponsor numbers line up</h1>
<p>Two reports disagree about the same sponsor campaign. Enter both sets of figures and see whether they count the same thing, over the same dates, before anyone argues about the gap. It raises review prompts. It does not say who is right.</p></header>
<section class="group"><h2>Start from an example or your own figures</h2>
<div class="row-actions"><button type="button" class="btn secondary" data-load="different">Example: different measures</button><button type="button" class="btn secondary" data-load="same">Example: same measure</button><button type="button" class="btn ghost" id="clear">Clear all</button></div>
<div class="callout note"><strong>Stays in this page</strong><p>Nothing you enter is sent, saved or uploaded. Reloading clears it. Examples use invented numbers.</p></div></section>
${sideHtml("ours", "Your records")}${sideHtml("theirs", "Their report")}
<section class="group" data-side="contract"><h2>What the agreement names (optional)</h2><p>Copy this from the agreement yourself. The tool does not read it.</p>
<p class="label">Which measure does the agreement count?</p><div class="choices" data-basis></div>
<div class="dates"><label class="label">Agreement window starts<input class="input" type="date" data-field="start"></label><label class="label">Agreement window ends<input class="input" type="date" data-field="end"></label></div></section>
<section class="group" id="result" aria-live="polite"></section>
<section class="group"><h2>What this does not do</h2><div class="callout note"><strong>Review prompts, not a finding</strong><p>It compares what you typed. It does not read the agreement, check either report, or say whether a payment is owed. A matching entry only means you entered the same thing twice. Column layouts differ by host and sponsor tool, so you choose the columns yourself.</p></div></section>`;
}

function sideOf(key: "ours" | "theirs"): Side { return state[key]; }
function contractOrSide(key: Key): Side | Contract { return key === "contract" ? state.contract : state[key]; }
const isKey = (k: string | undefined): k is Key => k === "ours" || k === "theirs" || k === "contract";

function syncForm(): void {
  for (const key of ["ours", "theirs", "contract"] as Key[]) {
    const root = $(`[data-side="${key}"]`);
    const s = contractOrSide(key) as unknown as Record<string, unknown>;
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]").forEach((el) => {
      const f = el.dataset.field as string;
      const v = f === "csv" ? (s.csv as Side["csv"]).text : s[f];
      if (typeof v === "string" && el.value !== v) el.value = v;
    });
    $("[data-basis]", root).innerHTML = basisButtons(key, (s.basis as string) || "unknown");
    if (key !== "contract") refreshColumns(key);
  }
}

function refreshColumns(key: "ours" | "theirs"): void {
  const root = $(`[data-side="${key}"]`); const s = sideOf(key); const csv = parseCsv(s.csv.text);
  $("[data-columns]", root).innerHTML = columnPickers(s, csv);
  $("[data-eps]", root).hidden = !csv.empty;
}

function paintResult(): void { $("#result").innerHTML = renderResult(state); }

function onInput(e: Event): void {
  const el = e.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || !el.dataset.field) return;
  const root = el.closest<HTMLElement>("[data-side]");
  const key = root?.dataset.side;
  if (!isKey(key)) return;
  const f = el.dataset.field;
  if (f === "csv" && key !== "contract") {
    const s = sideOf(key); const c = parseCsv(el.value); const g = c.empty ? { episodeCol: 0, countCol: -1 } : guessColumns(c);
    s.csv = { text: el.value, episodeCol: g.episodeCol, countCol: g.countCol };
    refreshColumns(key);
  } else (contractOrSide(key) as unknown as Record<string, string>)[f] = el.value;
  paintResult();
}

function flash(msg: string): void { const el = document.querySelector("#copy-status"); if (el) el.textContent = msg; }

async function copyNote(): Promise<void> {
  const ta = document.querySelector<HTMLTextAreaElement>("#note"); if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value);
    flash("Copied.");
  } catch {
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    flash(ok ? "Copied." : "Could not copy automatically. The note is selected: press Ctrl+C or Cmd+C.");
  }
}

function onClick(e: Event): void {
  const t = e.target; if (!(t instanceof Element)) return;
  const b = t.closest("button"); if (!b) return;
  const load = b.dataset.load;
  if (load === "different" || load === "same") { state = copy(EXAMPLES[load].input); syncForm(); paintResult(); return; }
  if (b.id === "clear") { state = blank(); syncForm(); paintResult(); return; }
  if (b.id === "copy") { void copyNote(); return; }
  const root = b.closest<HTMLElement>("[data-side]"); const key = root?.dataset.side;
  if (!root || !isKey(key)) return;
  if (b.dataset.choice) {
    const s = contractOrSide(key); s.basis = b.dataset.value as Side["basis"];
    $("[data-basis]", root).innerHTML = basisButtons(key, s.basis); paintResult();
  } else if (b.dataset.col && key !== "contract") {
    const s = sideOf(key); const col = b.dataset.col;
    if (col === "episodeCol" || col === "countCol") s.csv[col] = Number(b.dataset.value);
    refreshColumns(key); paintResult();
  }
}

build(); syncForm(); paintResult();
document.addEventListener("input", onInput);
document.addEventListener("click", onClick);
document.addEventListener("focusin", (e) => { if (e.target instanceof HTMLTextAreaElement && e.target.id === "note") e.target.select(); });
