// Pure rendering helpers: state in, HTML string out. No DOM access, so they can be tested in Node.
import { analyze, BASES, fmtInt, fmtPct, basisLabel } from "./core.js";
import type { BasisId, Csv, Gap, Input, Result, Side, Status } from "./core.js";

export const STATUS: Record<Status, string> = { same: "Same as entered", review: "Review", unknown: "Not entered" };

export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c] as string));
}

export function basisButtons(name: string, value: string): string {
  return BASES.map((b) => `<button type="button" class="choice" data-choice="${esc(name)}" data-value="${esc(b.id)}" aria-pressed="${b.id === value}">${esc(b.label)}</button>`).join("");
}

export function columnPickers(side: Pick<Side, "csv">, csv: Csv): string {
  if (csv.empty) return "";
  const opts = (field: string, sel: number) => csv.headers.map((h, i) => `<button type="button" class="choice" data-col="${field}" data-value="${i}" aria-pressed="${i === sel}">${esc(h || "(blank " + (i + 1) + ")")}</button>`).join("");
  return `<p class="label">Which column is the episode?</p><div class="choices">${opts("episodeCol", side.csv.episodeCol)}</div>
<p class="label">Which column is the count?</p><div class="choices">${opts("countCol", side.csv.countCol)}</div>`;
}

function callout(title: string, body: string, tone: string): string {
  return `<div class="callout ${tone}"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
}

function gapSentence(g: Gap): string {
  if (g.diff === 0) return "The two figures are equal.";
  const dir = g.diff < 0 ? "lower" : "higher";
  const pct = g.pctOfOurs == null ? "" : " That is " + fmtPct(Math.abs(g.pctOfOurs)) + " of your figure.";
  return "Their figure is " + fmtInt(Math.abs(g.diff)) + " " + dir + " than yours." + pct;
}

export function renderResult(input: Input, r: Result = analyze(input)): string {
  if (r.empty) return `<h2>Nothing to compare yet</h2><p>Enter a figure or paste rows on at least one side, or load an example.</p>`;
  const synthetic = /synthetic/i.test(input.ours.label + " " + input.theirs.label);
  let h = `<h2>What lines up and what does not</h2>`;
  if (synthetic) h += callout("Example data", "The figures here are invented. They show how the tool reads two reports, not any real show or sponsor.", "warning");
  r.warnings.forEach((w) => (h += callout("Check the input", w, "warning")));
  const g = r.gap;
  if (g) {
    const sign = g.diff > 0 ? "+" : g.diff < 0 ? "-" : "";
    h += `<dl class="facts"><div><dt>Yours</dt><dd>${esc(fmtInt(g.ours))} ${esc(basisLabel(input.ours.basis))}</dd></div>
<div><dt>Theirs</dt><dd>${esc(fmtInt(g.theirs))} ${esc(basisLabel(input.theirs.basis))}</dd></div>
<div><dt>Difference</dt><dd>${sign}${esc(fmtInt(Math.abs(g.diff)))}</dd></div></dl><p>${esc(gapSentence(g))}</p>`;
    if (!g.likeForLike) h += callout("Not a like-for-like gap", "The two figures are not marked as counting the same thing, so this difference is shown for reference only. Plays, downloads, ads delivered and impressions are never added or averaged here.", "warning");
  } else h += `<p>Add a total on both sides, or pick count columns for pasted rows, to see the difference.</p>`;
  h += `<ol class="rows">` + r.checks.map((c) => `<li class="row"><div><strong>${esc(c.title)}</strong><p>${esc(c.detail)}</p></div><span class="status ${esc(c.status)}">${esc(STATUS[c.status])}</span></li>`).join("") + `</ol>`;
  if (r.episodeTable) {
    h += `<h3>Per episode</h3><ol class="rows">` + r.episodeTable.rows.map((e) => {
      const d = (e.ours == null ? "Yours: not listed" : "Yours: " + fmtInt(e.ours)) + ". " + (e.theirs == null ? "Theirs: not listed" : "Theirs: " + fmtInt(e.theirs)) + ".";
      const v = e.diff == null ? e.note : e.diff === 0 ? "equal" : (e.diff > 0 ? "+" : "-") + fmtInt(Math.abs(e.diff));
      return `<li class="row"><div><strong>${esc(e.name)}</strong><p>${esc(d)}</p></div><span class="status">${esc(v)}</span></li>`;
    }).join("") + `</ol><p class="caption">${r.episodeTable.comparable ? "Episodes are matched by exact title, ignoring case and spacing." : "The two sides are not marked as counting the same thing, so per-episode differences are for reference only. Episodes are matched by exact title."}</p>`;
  }
  h += `<h2>What to line up before the call</h2><ol class="list">` + r.checklist.map((c) => `<li>${esc(c)}</li>`).join("") + `</ol>`;
  h += `<h2>A neutral note to the other side</h2><p>Built only from what you entered. Fill the brackets and read it before sending. Nothing is sent from here.</p>
<label class="label" for="note">Draft note</label><textarea id="note" class="text note" readonly>${esc(r.note)}</textarea>
<div class="row-actions"><button type="button" id="copy" class="btn">Copy note</button><span id="copy-status" role="status"></span></div>`;
  return h;
}
