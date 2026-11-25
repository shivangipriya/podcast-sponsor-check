# Testing

All data is invented. No real exports were used.

## Requirements checked
1. Different measures are never combined or called like-for-like, even when the totals are equal.
2. An unknown measure is never treated as the same measure.
3. Zero or missing figures give no percentage, never NaN or infinity.
4. Windows, timezones, filter wording and episode lists are compared on both sides and against the agreement as entered. Reversed and impossible dates are caught.
5. Numbers parse the way exports write them (1,234, 1,23,456, 12 345, quoted "1,200"). 12k, negatives and letters are rejected and reported.
6. Pasted rows are not dropped silently: unreadable rows are listed by line number, a Total row is flagged, duplicate episode titles raise a prompt.
7. A typed total beats pasted rows, with a warning showing both numbers.
8. No verdict language and no money claims in any output.
9. Entered text cannot inject markup into the page.
10. Copy works, and if the browser blocks clipboard access the note is selected with a message.

## Method
- `npm run typecheck`: strict TypeScript (`strict: true`) over all source, no errors.
- 36 logic tests in `test/core.test.mjs`, including a seeded 3000-input random run (never throws, no NaN, no verdict words, like-for-like only when the bases match).
- 7 rendering tests in `test/view.test.mjs` (escaping, warnings, examples, empty state, copy control).
- `npm run e2e` drives the page in headless Chrome at 390 px: example loading, Clear all, basis buttons, CSV paste and column pick, typed totals, reversed dates, basis mismatch, copy with clipboard read-back, copy fallback with the note selected, no horizontal overflow, no console errors.

## Results (25 Nov 2026)
`npm test` (type-check, build, tests): 43 pass, 0 fail. `npm run e2e`: all checks above behaved as listed; clipboard read-back returned the note text; fallback selected the note.

## Problems found while testing, and fixes
- Duplicate episode titles were summed without a prompt. Now flagged.
- The impressions-only label read "impressions (undefined)" in sentences. Now "impressions (no definition given)".
- The gap sentence read awkwardly. Rewritten.
- If under 80% of a column is numeric, the count column is not auto-picked and the page asks. This is deliberate.

## Not tested
Real host or sponsor exports, screen readers, keyboard order beyond native controls, browsers other than Chrome, and any measure of time saved or benefit.
