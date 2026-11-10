# Unmake website intelligence

This project remains a static browser interface, now served with a small local Node.js API. The analysis engine uses deterministic HTML rules, persistent SQLite history, retrieval of observed patterns, and user ratings to adjust future finding relevance. It does not train a machine-learning model.

## Run locally

Requirements: Node.js 22.13 or newer.

```sh
npm install
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The API binds to loopback by default. Analysis history is stored under `data/intelligence.sqlite`; set `DATA_DIR` or `DATABASE_PATH` to choose another local location. No API keys or external AI services are required.

## Frontend structure

The browser application uses Model–View–Presenter (MVP):

- `js/model.js` owns API requests, URL normalization, local HTML analysis, and reconstruction-file generation.
- `js/view.js` owns DOM rendering, workspace navigation, and presentation-only interactions.
- `js/presenter.js` coordinates user actions, analysis jobs, and application state.
- `poe-preview.js` is the module entry point; `poe-preview.html` and `poe-preview.css` remain the page and styles.

## Analysis and memory

- Submit a public HTTP(S) URL and choose a limit of 1, 3, or 5 pages.
- The crawler stays on the submitted hostname, checks `robots.txt`, follows only same-host redirects, and does not execute retrieved JavaScript.
- Reports include HTML structure, technology signatures, linked resource references, CSS signals, accessibility/SEO checks, heuristic confidence, and previously observed patterns.
- Confidence values are evidence-based heuristics, not calibrated statistical probabilities.
- Analyses and pattern counts are persisted in SQLite. Optional report ratings influence the relevance ordering of matching findings on later analyses. This is rule-based retrieval and feedback, not model training.
- Full source HTML is kept in process memory only until restart and is not written to the database. Reports and summarized analysis data are persistent.

## API

- `GET /api/health`
- `POST /api/analyses` — `{ "url": "https://example.com", "maxPages": 1 }`
- `GET /api/jobs/:id` — long-running job progress and completed report
- `GET /api/history`
- `GET /api/knowledge`
- `GET /api/analyses/:id`
- `GET /api/analyses/:id/compare?against=:otherId`
- `POST /api/analyses/:id/feedback` — `{ "usefulness": 4, "accuracy": 5 }`

## Safety and limitations

The fetcher allows only HTTP(S) on standard ports; resolves and rejects private, reserved, and non-routable addresses at every request; pins each connection to its validated DNS answer; revalidates redirects; sets request and response-size limits; and rejects cross-host redirects. It never evaluates remote scripts. The service listens on loopback and accepts same-origin API requests only; do not expose it directly to the public internet without adding authentication, deployment hardening, and operational rate limits.

The engine analyzes returned HTML rather than a fully rendered browser session, so JavaScript-generated content, computed styles, runtime interactions, and actual performance timings are not measured. It does not fetch external assets, crawl beyond five pages, bypass access controls, or perform security testing. `robots.txt` disallow rules are honored; if the policy cannot be retrieved, crawling stops.
