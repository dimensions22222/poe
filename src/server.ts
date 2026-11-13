import { createServer } from "node:http";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  analyzeWebsite,
  formatAnalysisReport,
  normalizeWebsiteUrl,
} from "./engine/analysis-engine.js";
import {
  enhanceAnalysis,
  isAiEnhancementEnabled,
} from "./engine/openai-enhancer.js";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(sourceDirectory, "..");
const publicDirectory = join(projectRoot, "public");
const dataDirectory = resolve(
  process.env.DATA_DIR || join(projectRoot, "data"),
);
const databasePath = resolve(
  process.env.DATABASE_PATH || join(dataDirectory, "intelligence.sqlite"),
);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const MAX_ACTIVE_JOBS = 2;
const MAX_JSON_BYTES = 64 * 1024;
const MONITOR_INTERVALS = new Set([6, 24, 168]);
const activeJobs = new Set();
const transientSources = new Map();
let schedulingMonitors = false;
const ultronAssetNames = [
  "core-mark",
  "overview",
  "analyze",
  "studio",
  "settings",
  "command",
  "menu",
  "external-link",
  "refresh",
  "monitor",
  "copy",
  "download",
];
const ultronStaticFiles: [string, [string, string]][] = ultronAssetNames.map(
  (name) => [
    `/assets/ultron/${name}.svg`,
    [
      join(publicDirectory, "assets", "ultron", `${name}.svg`),
      "image/svg+xml; charset=utf-8",
    ],
  ],
);
const staticFiles = new Map<string, [string, string]>([
  ["/", [join(publicDirectory, "index.html"), "text/html; charset=utf-8"]],
  [
    "/index.html",
    [join(publicDirectory, "index.html"), "text/html; charset=utf-8"],
  ],
  [
    "/styles.css",
    [join(publicDirectory, "styles.css"), "text/css; charset=utf-8"],
  ],
  [
    "/app.js",
    [join(publicDirectory, "app.js"), "text/javascript; charset=utf-8"],
  ],
  [
    "/ultron",
    [join(publicDirectory, "ultron.html"), "text/html; charset=utf-8"],
  ],
  [
    "/ultron.html",
    [join(publicDirectory, "ultron.html"), "text/html; charset=utf-8"],
  ],
  [
    "/ultron.css",
    [join(publicDirectory, "ultron.css"), "text/css; charset=utf-8"],
  ],
  [
    "/ultron.js",
    [join(publicDirectory, "ultron.js"), "text/javascript; charset=utf-8"],
  ],
  [
    "/js/model.js",
    [
      join(sourceDirectory, "web", "model.js"),
      "text/javascript; charset=utf-8",
    ],
  ],
  [
    "/js/view.js",
    [join(sourceDirectory, "web", "view.js"), "text/javascript; charset=utf-8"],
  ],
  [
    "/js/presenter.js",
    [
      join(sourceDirectory, "web", "presenter.js"),
      "text/javascript; charset=utf-8",
    ],
  ],
  ...ultronStaticFiles,
]);

mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
applyDatabaseMigrations();
database
  .prepare(
    "UPDATE jobs SET status = 'failed', stage = 'interrupted', error = 'Server restarted before this job finished.', updated_at = ? WHERE status = 'running'",
  )
  .run(new Date().toISOString());
database
  .prepare("UPDATE analyses SET status = 'failed' WHERE status = 'running'")
  .run();

function applyDatabaseMigrations() {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const migrationDirectory = join(sourceDirectory, "database", "migrations");
  const applied = new Set(
    database
      .prepare("SELECT filename FROM schema_migrations")
      .all()
      .map((row) => row.filename),
  );
  const migrations = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  for (const fileName of migrations) {
    if (applied.has(fileName)) continue;
    database.exec(readFileSync(join(migrationDirectory, fileName), "utf8"));
    database
      .prepare(
        "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
      )
      .run(fileName, new Date().toISOString());
  }
}

const statements = {
  insertAnalysis: database.prepare(
    "INSERT INTO analyses (id, url, title, status, created_at) VALUES (?, ?, ?, 'running', ?)",
  ),
  insertJob: database.prepare(
    "INSERT INTO jobs (id, analysis_id, status, stage, progress, updated_at) VALUES (?, ?, 'running', 'initializing', 0, ?)",
  ),
  updateJob: database.prepare(
    "UPDATE jobs SET status = ?, stage = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?",
  ),
  updateAnalysis: database.prepare(
    "UPDATE analyses SET title = ?, status = ?, completed_at = ?, analysis_json = ?, report = ? WHERE id = ?",
  ),
  getJob: database.prepare(`
    SELECT jobs.id, jobs.analysis_id AS analysisId, jobs.status, jobs.stage,
      jobs.progress, jobs.error, analyses.url, analyses.title,
      analyses.analysis_json AS analysisJson, analyses.report
    FROM jobs JOIN analyses ON analyses.id = jobs.analysis_id WHERE jobs.id = ?
  `),
  getAnalysis: database.prepare(
    "SELECT id, url, title, status, created_at AS createdAt, completed_at AS completedAt, analysis_json AS analysisJson, report FROM analyses WHERE id = ?",
  ),
  getHistory: database.prepare(`
    SELECT analyses.id, analyses.url, analyses.title, analyses.status,
      analyses.created_at AS createdAt, analyses.completed_at AS completedAt,
      analyses.analysis_json AS analysisJson, feedback.usefulness, feedback.accuracy
    FROM analyses LEFT JOIN feedback ON feedback.analysis_id = analyses.id
    WHERE analyses.status = 'complete' ORDER BY analyses.created_at DESC LIMIT ?
  `),
  upsertPattern: database.prepare(`
    INSERT INTO patterns (key, label, category, occurrences, first_seen, last_seen)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(key) DO UPDATE SET occurrences = patterns.occurrences + 1, last_seen = excluded.last_seen
  `),
  insertAnalysisPattern: database.prepare(
    "INSERT OR IGNORE INTO analysis_patterns (analysis_id, pattern_key) VALUES (?, ?)",
  ),
  insertFinding: database.prepare(
    "INSERT OR IGNORE INTO analysis_findings (analysis_id, finding_id) VALUES (?, ?)",
  ),
  upsertFeedback: database.prepare(`
    INSERT INTO feedback (analysis_id, usefulness, accuracy, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id) DO UPDATE SET
      usefulness = excluded.usefulness, accuracy = excluded.accuracy,
      comment = excluded.comment, created_at = excluded.created_at
  `),
  insertMonitor: database.prepare(`
    INSERT INTO monitored_sites (id, url, max_pages, interval_hours, next_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getMonitors: database.prepare(`
    SELECT id, url, max_pages AS maxPages, interval_hours AS intervalHours,
      next_run_at AS nextRunAt, last_run_at AS lastRunAt,
      last_analysis_id AS lastAnalysisId, last_error AS lastError
    FROM monitored_sites ORDER BY created_at DESC
  `),
  getMonitor: database.prepare(
    "SELECT id, url, max_pages AS maxPages, interval_hours AS intervalHours FROM monitored_sites WHERE id = ?",
  ),
  deleteMonitor: database.prepare("DELETE FROM monitored_sites WHERE id = ?"),
  dueMonitors: database.prepare(`
    SELECT id, url, max_pages AS maxPages, interval_hours AS intervalHours
    FROM monitored_sites WHERE next_run_at <= ? ORDER BY next_run_at LIMIT 10
  `),
  advanceMonitor: database.prepare(
    "UPDATE monitored_sites SET next_run_at = ? WHERE id = ?",
  ),
  completeMonitor: database.prepare(`
    UPDATE monitored_sites SET last_run_at = ?, last_analysis_id = ?, last_error = NULL,
      next_run_at = ? WHERE id = ?
  `),
  failMonitor: database.prepare(`
    UPDATE monitored_sites SET last_run_at = ?, last_error = ?, next_run_at = ? WHERE id = ?
  `),
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  sendJson(response, status, { error: message });
}

function inTransaction(callback) {
  database.exec("BEGIN IMMEDIATE");
  try {
    callback();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(
          Object.assign(new Error("Request body exceeds 64 KB."), {
            status: 413,
          }),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          Object.assign(new Error("Request body must be valid JSON."), {
            status: 400,
          }),
        );
      }
    });
  });
}

function loopbackHost(header) {
  if (!header || header.length > 255) return false;
  try {
    const parsed = new URL(`http://${header}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      parsed.hostname.toLowerCase(),
    );
  } catch {
    return false;
  }
}

function checkLocalRequest(request) {
  if (!loopbackHost(request.headers.host)) return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}`) return false;
  const fetchSite = request.headers["sec-fetch-site"];
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function safePatternKey(category, value) {
  return `${category}:${value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}

function storeCompletedAnalysis(analysisId, analysis, report) {
  const now = new Date().toISOString();
  const { sourceHtml, ...persistedAnalysis } = analysis;
  inTransaction(() => {
    statements.updateAnalysis.run(
      analysis.title,
      "complete",
      now,
      JSON.stringify(persistedAnalysis),
      report,
      analysisId,
    );
    for (const pattern of analysis.patterns) {
      const key = safePatternKey("design", pattern);
      statements.upsertPattern.run(key, pattern, "design", now, now);
      statements.insertAnalysisPattern.run(analysisId, key);
    }
    for (const technology of analysis.technologies) {
      const key = safePatternKey("technology", technology.name);
      statements.upsertPattern.run(
        key,
        technology.name,
        "technology",
        now,
        now,
      );
      statements.insertAnalysisPattern.run(analysisId, key);
    }
    for (const finding of analysis.findings) {
      statements.insertFinding.run(analysisId, finding.id);
    }
  });
  transientSources.set(analysisId, sourceHtml);
  if (transientSources.size > 10)
    transientSources.delete(transientSources.keys().next().value);
}

function knownPatternsFor(analysis) {
  const keys = [
    ...analysis.patterns.map((value) => safePatternKey("design", value)),
    ...analysis.technologies.map((value) =>
      safePatternKey("technology", value.name),
    ),
  ];
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(",");
  return database
    .prepare(
      `
    SELECT patterns.key, patterns.label, patterns.occurrences,
      ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS feedbackScore
    FROM patterns
    LEFT JOIN analysis_patterns ON analysis_patterns.pattern_key = patterns.key
    LEFT JOIN feedback ON feedback.analysis_id = analysis_patterns.analysis_id
    WHERE patterns.key IN (${placeholders})
    GROUP BY patterns.key
    ORDER BY COALESCE(feedbackScore, 0) DESC, patterns.occurrences DESC
    LIMIT 12
  `,
    )
    .all(...keys);
}

function historicalFindingScores(findings) {
  if (!findings.length) return new Map();
  const placeholders = findings.map(() => "?").join(",");
  const rows = database
    .prepare(
      `
    SELECT analysis_findings.finding_id AS findingId,
      ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS score,
      COUNT(feedback.analysis_id) AS ratings
    FROM analysis_findings
    JOIN feedback ON feedback.analysis_id = analysis_findings.analysis_id
    WHERE analysis_findings.finding_id IN (${placeholders})
    GROUP BY analysis_findings.finding_id
  `,
    )
    .all(...findings);
  return new Map(rows.map((row) => [row.findingId, row]));
}

function serializeAnalysisRow(row) {
  const analysis = row.analysisJson ? JSON.parse(row.analysisJson) : null;
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    pageCount: analysis?.pageCount || 0,
    confidence: analysis?.confidence || 0,
    technologyCount: analysis?.technologies?.length || 0,
    findingCount: analysis?.findings?.length || 0,
    feedback:
      row.usefulness == null
        ? null
        : {
            usefulness: row.usefulness,
            accuracy: row.accuracy,
          },
  };
}

async function runAnalysis(
  jobId,
  analysisId,
  url,
  maxPages,
  monitorId = null,
  monitorIntervalHours = null,
) {
  activeJobs.add(jobId);
  let currentStage = "validation";
  let currentProgress = 5;
  try {
    const analysis = await analyzeWebsite({
      url,
      maxPages,
      onStage: (stage) => {
        currentStage = stage.key;
        currentProgress = stage.progress;
        statements.updateJob.run(
          "running",
          stage.key,
          stage.progress,
          null,
          new Date().toISOString(),
          jobId,
        );
      },
    });
    const knownPatterns = knownPatternsFor(analysis);
    const findingScores = historicalFindingScores(
      analysis.findings.map((item) => item.id),
    );
    analysis.findings = analysis.findings
      .map((item) => {
        const historical = findingScores.get(item.id);
        return {
          ...item,
          history: historical
            ? { feedbackScore: historical.score, ratings: historical.ratings }
            : null,
          relevance: historical
            ? Math.round(item.confidence * 70 + (historical.score / 5) * 30)
            : Math.round(item.confidence * 100),
        };
      })
      .sort((left, right) => {
        const severityOrder = ["high", "medium", "low"];
        const severityDifference =
          severityOrder.indexOf(left.severity) -
          severityOrder.indexOf(right.severity);
        return severityDifference || right.relevance - left.relevance;
      });
    currentStage = "enhancement";
    currentProgress = 92;
    statements.updateJob.run(
      "running",
      currentStage,
      currentProgress,
      null,
      new Date().toISOString(),
      jobId,
    );
    if (isAiEnhancementEnabled()) {
      try {
        analysis.aiEnhancement = {
          status: "complete",
          text: await enhanceAnalysis(analysis),
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The AI enhancement failed.";
        console.error(
          `AI enhancement for analysis ${analysisId} failed: ${message}`,
        );
        analysis.aiEnhancement = { status: "failed", message };
      }
    } else {
      analysis.aiEnhancement = { status: "disabled" };
    }
    const report = formatAnalysisReport(analysis, knownPatterns);
    currentStage = "storing";
    currentProgress = 96;
    statements.updateJob.run(
      "running",
      "storing",
      96,
      null,
      new Date().toISOString(),
      jobId,
    );
    storeCompletedAnalysis(analysisId, analysis, report);
    statements.updateJob.run(
      "complete",
      "complete",
      100,
      null,
      new Date().toISOString(),
      jobId,
    );
    if (monitorId && monitorIntervalHours) {
      const completedAt = new Date();
      statements.completeMonitor.run(
        completedAt.toISOString(),
        analysisId,
        new Date(
          completedAt.getTime() + monitorIntervalHours * 60 * 60 * 1000,
        ).toISOString(),
        monitorId,
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The analysis failed.";
    console.error(`Website analysis ${analysisId} failed: ${message}`);
    statements.updateJob.run(
      "failed",
      currentStage,
      currentProgress,
      message.slice(0, 500),
      new Date().toISOString(),
      jobId,
    );
    database
      .prepare(
        "UPDATE analyses SET status = 'failed', completed_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), analysisId);
    if (monitorId && monitorIntervalHours) {
      const failedAt = new Date();
      statements.failMonitor.run(
        failedAt.toISOString(),
        message.slice(0, 500),
        new Date(
          failedAt.getTime() + monitorIntervalHours * 60 * 60 * 1000,
        ).toISOString(),
        monitorId,
      );
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

function startAnalysis(url, maxPages, monitor = null) {
  const analysisId = randomUUID();
  const jobId = randomUUID();
  const now = new Date().toISOString();
  inTransaction(() => {
    statements.insertAnalysis.run(analysisId, url, new URL(url).hostname, now);
    statements.insertJob.run(jobId, analysisId, now);
    if (monitor) {
      statements.advanceMonitor.run(
        new Date(
          Date.now() + monitor.intervalHours * 60 * 60 * 1000,
        ).toISOString(),
        monitor.id,
      );
    }
  });
  runAnalysis(
    jobId,
    analysisId,
    url,
    maxPages,
    monitor?.id || null,
    monitor?.intervalHours || null,
  );
  return { jobId, analysisId };
}

function runDueMonitors() {
  if (schedulingMonitors || activeJobs.size >= MAX_ACTIVE_JOBS) return;
  schedulingMonitors = true;
  try {
    const now = new Date().toISOString();
    for (const monitor of statements.dueMonitors.all(now)) {
      if (activeJobs.size >= MAX_ACTIVE_JOBS) break;
      startAnalysis(monitor.url, monitor.maxPages, monitor);
    }
  } catch (error) {
    console.error("Scheduled website analysis could not be started:", error);
  } finally {
    schedulingMonitors = false;
  }
}

function compareAnalyses(left, right) {
  const leftAnalysis = JSON.parse(left.analysisJson);
  const rightAnalysis = JSON.parse(right.analysisJson);
  const metricKeys = [
    ...new Set([
      ...Object.keys(leftAnalysis.counts),
      ...Object.keys(rightAnalysis.counts),
    ]),
  ];
  return {
    left: { id: left.id, title: left.title, url: left.url },
    right: { id: right.id, title: right.title, url: right.url },
    metrics: metricKeys.map((key) => ({
      name: key,
      left: leftAnalysis.counts[key] || 0,
      right: rightAnalysis.counts[key] || 0,
      change:
        (rightAnalysis.counts[key] || 0) - (leftAnalysis.counts[key] || 0),
    })),
    addedTechnologies: rightAnalysis.technologies
      .map((item) => item.name)
      .filter(
        (name) => !leftAnalysis.technologies.some((item) => item.name === name),
      ),
    removedTechnologies: leftAnalysis.technologies
      .map((item) => item.name)
      .filter(
        (name) =>
          !rightAnalysis.technologies.some((item) => item.name === name),
      ),
    addedPatterns: rightAnalysis.patterns.filter(
      (value) => !leftAnalysis.patterns.includes(value),
    ),
    removedPatterns: leftAnalysis.patterns.filter(
      (value) => !rightAnalysis.patterns.includes(value),
    ),
    addedFindings: rightAnalysis.findings.filter(
      (item) =>
        !leftAnalysis.findings.some((previous) => previous.id === item.id),
    ),
    resolvedFindings: leftAnalysis.findings.filter(
      (item) => !rightAnalysis.findings.some((next) => next.id === item.id),
    ),
  };
}

async function handleApi(request, response, pathname, searchParams) {
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      storage: "sqlite",
      learning: "rule-based retrieval",
      aiEnhancement: isAiEnhancementEnabled(),
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/history") {
    const limit = Math.min(
      50,
      Math.max(1, Number(searchParams.get("limit")) || 20),
    );
    sendJson(response, 200, {
      history: statements.getHistory.all(limit).map(serializeAnalysisRow),
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/monitors") {
    sendJson(response, 200, { monitors: statements.getMonitors.all() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/monitors") {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendError(response, 400, "The request body must be a JSON object.");
      return;
    }
    let url;
    try {
      url = normalizeWebsiteUrl(body.url).href;
    } catch (error) {
      throw Object.assign(error, { status: 400 });
    }
    const maxPages = Number(body.maxPages ?? 1);
    if (![1, 3, 5].includes(maxPages)) {
      sendError(response, 400, "Choose 1, 3, or 5 pages to analyze.");
      return;
    }
    const intervalHours = Number(body.intervalHours ?? 24);
    if (!MONITOR_INTERVALS.has(intervalHours)) {
      sendError(
        response,
        400,
        "Choose a monitoring interval of 6, 24, or 168 hours.",
      );
      return;
    }
    if (
      database.prepare("SELECT 1 FROM monitored_sites WHERE url = ?").get(url)
    ) {
      sendError(response, 409, "This URL is already being monitored.");
      return;
    }
    const id = randomUUID();
    const createdAt = new Date();
    statements.insertMonitor.run(
      id,
      url,
      maxPages,
      intervalHours,
      new Date(
        createdAt.getTime() + intervalHours * 60 * 60 * 1000,
      ).toISOString(),
      createdAt.toISOString(),
    );
    sendJson(response, 201, { id });
    return;
  }
  const monitorMatch = pathname.match(/^\/api\/monitors\/([0-9a-f-]{36})$/i);
  if (request.method === "DELETE" && monitorMatch) {
    const deleted = statements.deleteMonitor.run(monitorMatch[1]);
    if (!deleted.changes) {
      sendError(response, 404, "Monitored website was not found.");
      return;
    }
    sendJson(response, 200, { deleted: true });
    return;
  }
  if (request.method === "GET" && pathname === "/api/knowledge") {
    const totals = database
      .prepare(
        `
      SELECT COUNT(*) AS analyses,
        (SELECT COALESCE(SUM(occurrences), 0) FROM patterns) AS observations,
        (SELECT COUNT(*) FROM patterns) AS uniquePatterns,
        (SELECT COUNT(*) FROM feedback) AS feedbackCount,
        (SELECT ROUND(AVG((usefulness + accuracy) / 2.0), 1) FROM feedback) AS averageFeedback
      FROM analyses WHERE status = 'complete'
    `,
      )
      .get();
    const patterns = database
      .prepare(
        `
      SELECT patterns.key, patterns.label, patterns.category, patterns.occurrences,
        patterns.last_seen AS lastSeen,
        ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS feedbackScore,
        COUNT(feedback.analysis_id) AS ratings
      FROM patterns
      LEFT JOIN analysis_patterns ON analysis_patterns.pattern_key = patterns.key
      LEFT JOIN feedback ON feedback.analysis_id = analysis_patterns.analysis_id
      GROUP BY patterns.key ORDER BY patterns.occurrences DESC, patterns.label LIMIT 20
    `,
      )
      .all();
    const active = database
      .prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'")
      .get().count;
    sendJson(response, 200, {
      stats: { ...totals, activeJobs: active },
      patterns,
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/analyses") {
    if (activeJobs.size >= MAX_ACTIVE_JOBS) {
      sendError(
        response,
        429,
        "The analysis queue is full. Wait for a running analysis to finish.",
      );
      return;
    }
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendError(response, 400, "The request body must be a JSON object.");
      return;
    }
    let url;
    try {
      url = normalizeWebsiteUrl(body.url).href;
    } catch (error) {
      throw Object.assign(error, { status: 400 });
    }
    const maxPages = Number(body.maxPages ?? 1);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) {
      sendError(response, 400, "Choose between 1 and 5 same-site pages.");
      return;
    }
    sendJson(response, 202, startAnalysis(url, maxPages));
    return;
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && jobMatch) {
    const row = statements.getJob.get(jobMatch[1]);
    if (!row) {
      sendError(response, 404, "Analysis job was not found.");
      return;
    }
    const result = {
      id: row.id,
      analysisId: row.analysisId,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      error: row.error,
    };
    if (row.status === "complete") {
      result.report = row.report;
      result.analysis = JSON.parse(row.analysisJson);
      result.sourceHtml = transientSources.get(row.analysisId) || "";
    }
    sendJson(response, 200, result);
    return;
  }
  const compareMatch = pathname.match(
    /^\/api\/analyses\/([0-9a-f-]{36})\/compare$/i,
  );
  if (request.method === "GET" && compareMatch) {
    const otherId = searchParams.get("against");
    const left = statements.getAnalysis.get(compareMatch[1]);
    const right = otherId && statements.getAnalysis.get(otherId);
    if (
      !left ||
      !right ||
      left.status !== "complete" ||
      right.status !== "complete"
    ) {
      sendError(
        response,
        404,
        "Both completed analyses are required for comparison.",
      );
      return;
    }
    sendJson(response, 200, { comparison: compareAnalyses(left, right) });
    return;
  }
  const feedbackMatch = pathname.match(
    /^\/api\/analyses\/([0-9a-f-]{36})\/feedback$/i,
  );
  if (request.method === "POST" && feedbackMatch) {
    const analysis = statements.getAnalysis.get(feedbackMatch[1]);
    if (!analysis || analysis.status !== "complete") {
      sendError(response, 404, "Completed analysis was not found.");
      return;
    }
    const body = await readJson(request);
    const usefulness = Number(body.usefulness);
    const accuracy = Number(body.accuracy);
    if (
      !Number.isInteger(usefulness) ||
      usefulness < 1 ||
      usefulness > 5 ||
      !Number.isInteger(accuracy) ||
      accuracy < 1 ||
      accuracy > 5
    ) {
      sendError(
        response,
        400,
        "Usefulness and accuracy ratings must be whole numbers from 1 to 5.",
      );
      return;
    }
    const comment =
      typeof body.comment === "string" ? body.comment.trim().slice(0, 300) : "";
    database
      .prepare(
        "INSERT INTO feedback (analysis_id, usefulness, accuracy, comment, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(analysis_id) DO UPDATE SET usefulness = excluded.usefulness, accuracy = excluded.accuracy, comment = excluded.comment, created_at = excluded.created_at",
      )
      .run(
        analysis.id,
        usefulness,
        accuracy,
        comment,
        new Date().toISOString(),
      );
    sendJson(response, 200, { saved: true });
    return;
  }
  const analysisMatch = pathname.match(/^\/api\/analyses\/([0-9a-f-]{36})$/i);
  if (request.method === "GET" && analysisMatch) {
    const row = statements.getAnalysis.get(analysisMatch[1]);
    if (!row || row.status !== "complete") {
      sendError(response, 404, "Completed analysis was not found.");
      return;
    }
    const feedback =
      database
        .prepare(
          "SELECT usefulness, accuracy, comment, created_at AS createdAt FROM feedback WHERE analysis_id = ?",
        )
        .get(row.id) || null;
    sendJson(response, 200, {
      id: row.id,
      url: row.url,
      title: row.title,
      createdAt: row.createdAt,
      analysis: JSON.parse(row.analysisJson),
      report: row.report,
      sourceHtml: transientSources.get(row.id) || "",
      feedback,
    });
    return;
  }
  sendError(response, 404, "API endpoint was not found.");
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers.host || "localhost"}`,
    );
    const pathname = requestUrl.pathname;
    if (pathname.startsWith("/api/")) {
      if (!checkLocalRequest(request)) {
        sendError(
          response,
          403,
          "This local analysis service only accepts same-origin requests.",
        );
        return;
      }
      await handleApi(request, response, pathname, requestUrl.searchParams);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendError(
        response,
        405,
        "Only GET and HEAD are supported for static files.",
      );
      return;
    }
    const entry = staticFiles.get(pathname);
    if (!entry) {
      sendError(response, 404, "File was not found.");
      return;
    }
    const [filePath, contentType] = entry;
    const content = await import("node:fs/promises").then((fs) =>
      fs.readFile(filePath),
    );
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    const status =
      Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error("Request failed:", error);
    sendError(
      response,
      status,
      status < 500 ? error.message : "The request could not be completed.",
    );
  }
});

server.listen(port, host, () => {
  console.log(
    `Website intelligence engine listening at http://${host}:${port}`,
  );
  console.log(`Persistent analysis database: ${databasePath}`);
  runDueMonitors();
});
const monitorTimer = setInterval(runDueMonitors, 30_000);
monitorTimer.unref();

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
