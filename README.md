# Mahoraga

Mahoraga is GOJO.DEV's lead-discovery and manual outreach workspace. It turns a
natural-language search into a scored lead queue, checks candidate business
websites, and prepares WhatsApp messages for review. It does not send messages
or persist lead data to a shared database.

## What it does

1. Parses a search such as `private schools in Ikeja without websites`.
2. Geocodes the location with Nominatim.
3. Discovers structured businesses through OpenStreetMap Overpass.
4. Adds web-search candidates. A configured SearXNG instance is preferred;
   otherwise the server uses a conservative DuckDuckGo HTML fallback.
5. Uses `@gojodev/mahoraga-crawl` to extract public business and contact data
   from suitable result pages.
6. searches for each business by name and location, then checks candidate
   standalone domains.
7. Classifies the result as `verified`, `uncertain`, or `not_found`.
   `not_found` means no credible standalone site was found by the checks; it
   is not proof that no website exists.
8. Scores the opportunity and generates a contextual WhatsApp pitch.
9. Opens WhatsApp with the message prefilled. The user reviews and sends it
   manually.

The workspace supports untouched and touched lead queues, website and phone
filters, message variations, JSON/CSV export, and source links.

## Requirements

- Node.js 20 or newer
- npm
- outbound HTTPS access to the configured geocoding, map, search, and public
  website endpoints
- a modern browser

No API key is required for the default Nominatim, Overpass, and DuckDuckGo
configuration. Availability and usage policies of those third-party services
still apply.

## Run locally

Install the locked dependencies and start the full-stack Express application:

```bash
git clone https://github.com/gojocodes-all/mahoraga.git
cd mahoraga
npm ci
npm start
```

Open `http://localhost:3000`. The same process serves the frontend and the
`/api` routes.

Try searches that include both a business type and location:

```text
private schools in Ikeja without websites
salons around Surulere
estate agents near Abuja
```

If no location phrase is present, the parser uses `Lagos, Nigeria`.

## Configuration

All configuration is read from process environment variables. The application
does not load a `.env` file by itself.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port used by the Express server. |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Base URL for geocoding searches. |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Overpass interpreter endpoint used for OpenStreetMap discovery. |
| `SEARXNG_URL` | empty | Optional SearXNG base URL. Its instance must permit JSON search responses. |

For example:

```bash
PORT=4000 SEARXNG_URL=https://search.example.com npm start
```

Without `SEARXNG_URL`, Mahoraga falls back to DuckDuckGo HTML search. If a
configured SearXNG request fails or returns no results, the same fallback is
used.

## Data and operating limits

- Search jobs and lead results live only in server memory. Restarting the
  backend clears them.
- Completed jobs expire after roughly two hours.
- Touched-lead state is stored in the current browser's `localStorage`; it is
  not synchronized between browsers or devices.
- A client may start at most six searches in a rolling ten-minute window.
- Each search accepts 5–40 requested leads; the interface defaults to 20.
- Exports are available only while the corresponding in-memory job exists.
- There is no user authentication or multi-user isolation layer. Deploy this
  workspace only where that access model is appropriate.

## API overview

| Method and route | Purpose |
| --- | --- |
| `GET /api/health` | Report service and discovery-provider status. |
| `POST /api/jobs` | Start a bounded discovery job with `query` and optional `limit`. |
| `GET /api/jobs/:id` | Poll job progress and retrieve completed leads. |
| `GET /api/jobs/:id/export.json` | Download current job leads as JSON. |
| `GET /api/jobs/:id/export.csv` | Download current job leads as CSV. |
| `POST /api/verify` | Re-check one normalized lead's website candidates. |

The API is an internal application contract rather than a versioned public API.

## Deployment

The repository supports two deployment shapes:

- **Single service:** run `npm ci` and `npm start`. Express serves both the
  static files in `public/` and the API.
- **Split frontend/backend:** `vercel.json` copies `public/` into `dist/`
  and deploys it as a static frontend. Requests under `/api/` are rewritten
  to the configured backend URL in that file. The separate backend must run
  `npm start`, allow outbound requests, and remain reachable at that rewrite
  destination.

When deploying your own split environment, update the rewrite destination in
`vercel.json` to your backend. A frontend-only deployment without a reachable
API backend can render the interface but cannot perform searches. The browser
includes retry messaging for a sleeping or temporarily unavailable backend.

## Safety and crawl boundaries

- The crawler accepts public HTTP/HTTPS targets only and blocks local/private
  network destinations.
- Site crawls respect `robots.txt`, stay on the same hostname, and are bounded
  by page count, depth, concurrency, and delay.
- Website classifications are evidence-based estimates and remain visible for
  user review.
- WhatsApp sending is never automated.
- Use the workspace only for lawful, respectful research and honor source-site
  policies and contact preferences.

## Project structure

```text
public/                 Static interface, client state, and backend retry logic
src/server.js           Express API and network discovery orchestration
src/lead-domain.js      Pure parsing, normalization, scoring, and message rules
test/                   Node.js domain and accessibility regression tests
.github/workflows/ci.yml  Locked install, validation, and dependency audit
vercel.json             Static build, headers, and API rewrite configuration
```

The crawler dependency is pinned to a commit archive from the separate
`mahoraga-crawl` repository so installs resolve the reviewed implementation.

## Development and validation

Run the repository's complete local validation:

```bash
npm run validate
```

This syntax-checks the server, domain module, browser scripts, and tests before
running the Node.js test suite. Pull requests and pushes to `main` run the same
validation on Node.js 20 after a locked `npm ci` install. CI also fails for
high- or critical-severity npm advisories.

The current Crawlee dependency chain reports moderate `stream-json`
advisories with no available fix. Review that upstream dependency before
raising the audit threshold.

## Contributing

Keep domain rules deterministic and testable in `src/lead-domain.js`. Keep
network access and Express response handling in `src/server.js`. Changes to
queue semantics or other accessibility contracts should update the focused
tests in `test/`.

Before opening a pull request:

1. Run `npm ci`.
2. Run `npm run validate`.
3. Run `npm audit --audit-level=high`.
4. Confirm that no secrets, private lead exports, or local environment files
   are included.

## Open-source research

- Crawlee provides bounded crawling.
- SearXNG's documented HTTP/JSON API is the preferred configurable metasearch
  provider.
- OpenStreetMap Nominatim and Overpass provide geographic discovery.
- The no-key DuckDuckGo fallback was independently implemented after reviewing
  OEvortex/ddg_search (Apache-2.0), which demonstrates the same HTML result
  pattern.
