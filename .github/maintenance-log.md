# Maintenance log

## 2026-09-28 — Make lead queue tabs keyboard and screen-reader accessible

- **Rationale:** The Untouched and Touched queue controls looked like tabs but did not expose tab semantics or selected state, and keyboard users could not move between them with standard tab-list navigation keys.
- **Files changed:** Updated `public/index.html` and `public/app.js`; added `test/ui-accessibility.test.js`.
- **Validation:** `npm run validate` (syntax checks and eight Node test cases), focused static accessibility assertions, a local `npm start` smoke test with healthy `/api/health` and served tab markup, and `git diff --check`.
- **Risk:** Low. Queue filtering, persistence, and outreach behavior are unchanged; the update adds semantic state and keyboard navigation around the existing tab switch.
- **Rollback:** Revert this pull request to restore the previous click-only queue controls.

## 2026-09-22 — Isolate and test the lead domain

- **Rationale:** Lead-query parsing, normalization, deduplication, scoring, and message generation were embedded in the network-facing server. Moving these deterministic rules behind a domain module makes them reviewable and testable without starting the server or contacting third-party services.
- **Files changed:** Added `src/lead-domain.js`, `test/lead-domain.test.js`, and `.gitignore`; updated `src/server.js`, `package.json`, and `README.md`.
- **Validation:** `npm run validate` (syntax checks for server, domain, browser scripts, and tests; six Node test cases) and an `npm start` boot smoke test on a non-default port.
- **Risk:** Low. Existing rule implementations and public API shapes are preserved; the change introduces no runtime dependency or external-service behavior change.
- **Rollback:** Revert this pull request to restore the domain helpers inside `src/server.js` and remove the test entry points.
