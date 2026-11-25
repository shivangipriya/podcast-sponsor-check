# Podcast sponsor numbers check

A small browser tool for the moment two reports about the same podcast sponsorship do not match. Before arguing about the gap, it checks whether the two numbers count the same thing, over the same dates, in the same timezone, with the same filters and episodes.

It gives review prompts and a neutral draft note. It does not say who is right, does not read agreements and does not estimate money owed. It never adds or averages plays, downloads, ads delivered, confirmed ad plays, listeners or impressions.

## Status
Prototype, tested on invented data only. No real Buzzsprout, Libsyn, Spotify or Apple export was available, so you choose the columns yourself and there is no automatic reconciliation of two exports. Evidence of need so far is two anecdotal forum threads, not validated demand.

## Run it
Written in strict TypeScript. Node 20 or later. The only dependency is the TypeScript compiler (version locked in package-lock.json).

    npm ci           # install the compiler
    npm test         # type-check, build, run 43 tests
    npm start        # build, then serve http://localhost:8080
    npm run e2e      # optional: headless Chrome click-through (CHROME=/path/to/chrome if needed)

`npm run build` writes plain JavaScript to `dist/`. Serve the folder with any static file server and load `index.html`. Opening the file directly will not work, because browsers block ES modules on `file://`.

## How to use
1. Load an example or start blank. Examples are invented.
2. For each side, say what the number counts, then enter a total or paste per-episode CSV rows and pick the episode and count columns.
3. Add window dates, timezone and filter wording if you know them, and what the agreement names.
4. Read the review prompts. Copy the neutral note, fill the brackets, read it before sending. Nothing is sent from the page and nothing is stored.

## Layout
- `src/core.ts`: logic, no DOM, typed inputs and results.
- `src/view.ts`: renders results to escaped HTML strings.
- `src/app.ts`, `src/style.css`, `index.html`: the page.
- `test/`: logic and rendering tests (run against the built output). See TESTING.md.

## Licence
MIT. See LICENSE.
