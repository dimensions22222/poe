# ULTRON UNMAKE

# Unmake website intelligence

This project remains a static browser interface, now served with a small local Node.js service. The analysis engine uses deterministic HTML rules, persistent SQLite history, retrieval of observed patterns, and user ratings to adjust future finding relevance. Optional AI-enhanced insights are available when an OpenAI API key is configured; without it, analysis remains local and rule-based.

## Run locally

Requirements: Node.js 22.13 or newer.

```sh
npm install
npm start
```

On Windows PowerShell, use `npm.cmd start` if PowerShell blocks `npm.ps1` because of its execution-policy setting.

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The local service binds to loopback by default. Analysis history is stored under `data/intelligence.sqlite`; set `DATA_DIR` or `DATABASE_PATH` to choose another local location.

To enable optional AI-enhanced insights, set `OPENAI_API_KEY` in the server process environment. The key stays server-side and is never stored in the database or sent to the browser. `OPENAI_MODEL` optionally selects a model; the default is `gpt-4.1-mini`.

PowerShell:

```powershell
$secret = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = (New-Object System.Net.NetworkCredential("", $secret)).Password
$env:OPENAI_MODEL = "gpt-4.1-mini"
npm start
```

The AI request contains a compact summary of extracted page data (such as headings, technology signals, design tokens, and findings); it does not include full source HTML or linked resource URLs. This sends website-derived summary data to OpenAI. If AI enhancement is not configured or a request fails, deterministic analysis remains available and the UI reports the enhancement status. Revoke any key accidentally pasted into chat or committed to source control.

## Project structure

The browser application uses Model–View–Presenter (MVP):

- `src/web/model.js` owns API requests, URL normalization, local HTML analysis, and reconstruction-file generation.
- `src/web/view.js` owns DOM rendering, workspace navigation, and presentation-only interactions.
- `src/web/presenter.js` coordinates user actions, analysis jobs, and application state.
- `public/app.js` is the browser entry point; `public/index.html` and `public/styles.css` are the static interface files.
- The sidebar switches between complete workspace pages (Overview, Website analysis, Reconstruction studio, and Settings) rather than scrolling through every workspace area in one view.

```
src/
  server.mjs             # HTTP API, persistence, scheduling, and static-file routing
  engine/                # Website analysis and optional AI enhancement
  web/                   # Browser Model-View-Presenter modules
public/                  # Browser entry point, HTML, and styles
tests/                   # Node test suite
docs/                    # Architecture and developer documentation
data/                    # Local SQLite runtime data (ignored by Git)
```

See [the architecture guide](docs/ARCHITECTURE.md) for ownership boundaries and common development tasks.

## If the engine says offline

The browser interface calls the local API at the same origin. Start the service from this project and open the URL it prints:

```powershell
npm.cmd start
```

Then visit [http://127.0.0.1:3000](http://127.0.0.1:3000). Do not open `public/index.html` directly from the file system or serve it from a different development server; either case makes its `/api/*` requests miss the local analysis engine and it will show as unavailable.

## Analysis and memory

- Submit a public HTTP(S) URL and choose a limit of 1, 3, or 5 pages.
- Pasting or entering a URL in the analysis field starts a scan automatically after a short pause; the Analyze URL button remains available for manual submission.
- Save URLs for automatic monitoring every 6 hours, daily, or weekly. Checks run only while the local server is running, and due checks resume when it starts.
- The crawler stays on the submitted hostname, checks `robots.txt`, follows only same-host redirects, and does not execute retrieved JavaScript.
- Reports include HTML structure, technology signatures, linked resource references, CSS signals, accessibility/SEO checks, heuristic confidence, and previously observed patterns.
- When configured, OpenAI adds evidence-based narrative and prioritized recommendations using extracted report data; it does not receive source HTML.
- Confidence values are evidence-based heuristics, not calibrated statistical probabilities.
- Analyses and pattern counts are persisted in SQLite. Optional report ratings influence the relevance ordering of matching findings on later analyses. This is rule-based retrieval and feedback, not model training.
- Full source HTML is kept in process memory only until restart and is not written to the database. Reports and summarized analysis data are persistent.
- Completed interactive and scheduled analyses automatically generate reconstruction files in the browser. The newest scheduled result is opened and rebuilt when the page detects it; historical reports can also rebuild while their source remains in memory.
- The Reconstruction Studio can prepare a static website copy for sites you own or are authorized to reproduce. It includes the fetched HTML response and a portable version with resource links resolved to the original website; it does not copy backend systems, authenticated content, private APIs, databases, payment flows, or runtime-only states.

## API

- `GET /api/health`
- `POST /api/analyses` — `{ "url": "https://example.com", "maxPages": 1 }`
- `GET /api/jobs/:id` — long-running job progress and completed report
- `GET /api/history`
- `GET /api/monitors`
- `POST /api/monitors` — `{ "url": "https://example.com", "maxPages": 1, "intervalHours": 24 }`
- `DELETE /api/monitors/:id`
- `GET /api/knowledge`
- `GET /api/analyses/:id`
- `GET /api/analyses/:id/compare?against=:otherId`
- `POST /api/analyses/:id/feedback` — `{ "usefulness": 4, "accuracy": 5 }`

## Safety and limitations

The fetcher allows only HTTP(S) on standard ports; resolves and rejects private, reserved, and non-routable addresses at every request; pins each connection to its validated DNS answer; revalidates redirects; sets request and response-size limits; and rejects cross-host redirects. It never evaluates remote scripts. The service listens on loopback and accepts same-origin requests only; do not expose it directly to the public internet without adding authentication, deployment hardening, and operational rate limits.

The engine analyzes returned HTML rather than a fully rendered browser session, so JavaScript-generated content, computed styles, runtime interactions, and actual performance timings are not measured. It does not fetch external assets, crawl beyond five pages, bypass access controls, or perform security testing. `robots.txt` disallow rules are honored; if the policy cannot be retrieved, crawling stops.
