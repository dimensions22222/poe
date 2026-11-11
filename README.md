# Unmake website intelligence

This project remains a static browser interface, now served with a small local Node.js service. The analysis engine uses deterministic HTML rules, persistent SQLite history, retrieval of observed patterns, and user ratings to adjust future finding relevance. Optional AI-enhanced insights are available when an OpenAI API key is configured; without it, analysis remains local and rule-based.

## Run locally

Requirements: Node.js 22.13 or newer.

```sh
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The local service binds to loopback by default. Analysis history is stored under `data/intelligence.sqlite`; set `DATA_DIR` or `DATABASE_PATH` to choose another local location.

To enable optional AI-enhanced insights, set `OPENAI_API_KEY` in the server process environment. The key stays server-side and is never stored in the database or sent to the browser. `OPENAI_MODEL` optionally selects a model; the default is `gpt-4.1-mini`.

PowerShell:

```powershell
$env:OPENAI_API_KEY = "your-new-key"
$env:OPENAI_MODEL = "gpt-4.1-mini"
npm start
```

The AI request contains a compact summary of extracted page data (such as headings, technology signals, design tokens, and findings); it does not include full source HTML or linked resource URLs. This sends website-derived summary data to OpenAI. If AI enhancement is not configured or a request fails, deterministic analysis remains available and the UI reports the enhancement status. Revoke any key accidentally pasted into chat or committed to source control.

## Frontend structure

The browser application uses Model–View–Presenter (MVP):

- `js/model.js` owns API requests, URL normalization, local HTML analysis, and reconstruction-file generation.
- `js/view.js` owns DOM rendering, workspace navigation, and presentation-only interactions.
- `js/presenter.js` coordinates user actions, analysis jobs, and application state.
- `poe-preview.js` is the module entry point; `poe-preview.html` and `poe-preview.css` remain the page and styles.

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
