# Mahoraga

Mahoraga is GOJO.DEV's lead-discovery and outreach workspace.

## Pipeline
1. Parse a natural-language hunt such as `private schools in Ikeja without websites`.
2. Geocode the location with Nominatim.
3. Discover structured local businesses with OpenStreetMap Overpass.
4. Discover additional candidates with web search. If `SEARXNG_URL` is configured, SearXNG JSON search is preferred; otherwise a conservative DuckDuckGo HTML fallback is used.
5. Use `@gojodev/mahoraga-crawl` (the `mahoraga-crawl` repo) to extract structured business/contact data from suitable public result pages.
6. Search for each business by name + location and directly fetch candidate standalone domains.
7. Classify the website result as `verified`, `uncertain`, or `not_found`. `not_found` means no credible standalone site was found in the checks; it is not proof that no website exists anywhere.
8. Score the sales opportunity and generate a contextual WhatsApp pitch.
9. Opening WhatsApp moves the lead from **Untouched** to **Touched** in local browser storage.

## Safety / crawl boundaries
- Public HTTP/HTTPS only.
- Local/private network targets are blocked by the crawler package.
- Site crawls respect `robots.txt` and stay on the same hostname.
- Search jobs are rate-limited and bounded.
- WhatsApp sending is never automated; the user reviews and sends manually.

## Optional SearXNG
Set `SEARXNG_URL=https://your-searxng.example` to use a SearXNG instance that enables JSON output. Without it, Mahoraga falls back to DuckDuckGo HTML search.

## Run
```bash
npm install
npm start
```

## Open-source research used
- Crawlee for bounded crawling.
- SearXNG's documented HTTP/JSON search API as the preferred configurable metasearch provider.
- OpenStreetMap Nominatim + Overpass for geographic discovery.
- The no-key DuckDuckGo fallback was independently implemented after reviewing OEvortex/ddg_search (Apache-2.0), which demonstrates the same DuckDuckGo HTML result pattern.
