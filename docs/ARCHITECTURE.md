# Architecture guide

## Directory ownership

| Directory | Purpose | Change it when… |
| --- | --- | --- |
| `src/server.mjs` | Local HTTP server, API routes, SQLite persistence, and monitoring scheduler | Adding an endpoint, persistence behavior, or server configuration |
| `src/engine/` | Website retrieval, deterministic analysis, and optional AI enhancement | Changing crawl safeguards, analysis rules, or AI report enrichment |
| `src/web/` | Browser-side Model-View-Presenter code | Changing browser behavior, state coordination, or DOM rendering |
| `public/` | Files delivered directly to the browser | Changing page markup, styles, or the browser entry module |
| `tests/` | Fast Node-based regression tests | Adding coverage for a bug fix or feature |
| `data/` | Local SQLite database and runtime state | Never edit manually; it is generated locally and ignored by Git |

## Browser flow

`public/app.js` creates the model, view, and presenter. The presenter requests data through the model, then tells the view what to render. Keep network calls in `src/web/model.js`, DOM updates in `src/web/view.js`, and user-flow/state changes in `src/web/presenter.js`.

The server exposes the browser modules at `/js/*.js`. This keeps the project dependency-free and avoids a separate frontend build step.

## Typical changes

- **New API endpoint:** add validation and route handling in `src/server.mjs`, then add its client method in `src/web/model.js` and tests in `tests/`.
- **New website finding:** add the extraction or rule in `src/engine/analysis-engine.mjs`, add a focused test, and render it through the existing analysis view.
- **New interface page or control:** update `public/index.html` and `public/styles.css`; place interaction behavior in the MVP module with the appropriate responsibility.
- **New environment setting:** document it in `README.md`, read it once near the top of `src/server.mjs`, and supply a safe default.

## Local commands

```powershell
npm.cmd start
npm.cmd test
```

Open `http://127.0.0.1:3000` after starting the service. The browser app must be served by this Node process because its API is same-origin.
