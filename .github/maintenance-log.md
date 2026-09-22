# Maintenance log

## 2026-09-22 — Isolate and test the lead domain

- **Rationale:** Lead-query parsing, normalization, deduplication, scoring, and message generation were embedded in the network-facing server. Moving these deterministic rules behind a domain module makes them reviewable and testable without starting the server or contacting third-party services.
- **Files changed:** Added `src/lead-domain.js`, `test/lead-domain.test.js`, and `.gitignore`; updated `src/server.js`, `package.json`, and `README.md`.
- **Validation:** `npm run validate` (syntax checks for server, domain, browser scripts, and tests; six Node test cases) and an `npm start` boot smoke test on a non-default port.
- **Risk:** Low. Existing rule implementations and public API shapes are preserved; the change introduces no runtime dependency or external-service behavior change.
- **Rollback:** Revert this pull request to restore the domain helpers inside `src/server.js` and remove the test entry points.
