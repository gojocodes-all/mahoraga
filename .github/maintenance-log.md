# Maintenance log

## 2026-10-22 — Enforce lead relevance filtering

- **Rationale:** The discovery pipeline filters candidates with `relevanceScore(...) > 0`, but the scoring function always returned at least one. Businesses with no business-type match could therefore reach verification and the final lead queue merely because they had contact details.
- **Files changed:** Updated `src/lead-domain.js` to return zero when a query has business keywords and none match the candidate while preserving singular/plural matches; expanded `test/lead-domain.test.js`; updated this maintenance log.
- **Validation:** Ran `npm ci`, `npm run validate`, `npm audit --audit-level=high`, and `git diff --check`; the focused regression verifies that an unrelated pharmacy is rejected from a school search while a singular `School` category still scores as relevant.
- **Risk:** Low. The change affects only candidates that do not match any parsed business keyword. Matching leads retain the existing contact and location score bonuses, API shapes remain unchanged, and searches with no usable business keywords keep their prior contact-based scoring.
- **Rollback:** Revert this pull request to restore the previous minimum relevance score and remove the focused regression.

## 2026-10-14 — Separate the HTTP application from process startup

- **Rationale:** Importing the API implementation immediately opened a network port, which coupled route behavior to process startup and prevented focused HTTP contract tests. Parser failures and unknown API routes also fell through to Express's HTML error responses instead of the JSON contract used by the application.
- **Files changed:** Moved Express configuration and discovery orchestration to `src/app.js`; reduced `src/server.js` to validated startup and graceful shutdown; added `test/http.test.js`; updated `package.json`, `README.md`, and this maintenance log.
- **Validation:** `npm run validate` (syntax checks and 12 Node test cases), `npm audit --audit-level=high`, a production entry-point startup/health/shutdown smoke test, and `git diff --check`.
- **Risk:** Low. Existing successful routes, discovery logic, frontend assets, dependencies, and deployment commands are unchanged. The only response change is that malformed JSON and unknown `/api` routes now return explicit JSON errors.
- **Rollback:** Revert this pull request to restore the single-file server entry point and Express's default error responses.

## 2026-10-08 — Document runtime, data, and deployment contracts

- **Rationale:** The README described the discovery pipeline and a start command but did not explain the Node.js requirement, environment variables, in-memory job lifecycle, browser-local touched state, API routes, operating limits, or the repository's supported single-service and split frontend/backend deployments.
- **Files changed:** Expanded `README.md`; updated this maintenance log.
- **Validation:** Cross-checked every documented command, variable, default, route, limit, persistence statement, project path, and deployment step against `package.json`, `src/server.js`, `src/lead-domain.js`, `public/app.js`, `public/network.js`, `vercel.json`, the tests, and CI configuration; verified referenced repository paths; reviewed the complete documentation diff.
- **Risk:** Low. Documentation only; application code, dependencies, configuration, and runtime behavior are unchanged.
- **Rollback:** Revert this pull request to restore the shorter README.

## 2026-10-04 — Add reproducible installs and CI validation

- **Rationale:** The repository had deterministic validation scripts but no lockfile or hosted pull-request checks. Dependency resolution could drift between installs, including the Git-based crawler dependency, and regressions could reach `main` without running the test suite.
- **Files changed:** Added `package-lock.json` and `.github/workflows/ci.yml`; pinned the Git-based crawler dependency in `package.json`; updated `README.md` and this maintenance log.
- **Validation:** Generated the lockfile with npm; completed a clean `npm ci`; ran `npm run validate` (syntax checks and eight Node test cases); ran `npm audit --audit-level=high`; parsed the workflow YAML; and ran `git diff --check`.
- **Risk:** Low. Application source and runtime behavior are unchanged. The lockfile pins the dependency graph, and CI uses read-only repository permissions. npm currently reports 13 moderate transitive Crawlee advisories in `stream-json` with no available fix; no high or critical advisories were reported.
- **Rollback:** Revert this pull request to remove the lockfile and workflow and restore the previous installation guidance.

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
