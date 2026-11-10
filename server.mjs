import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  analyzeWebsite,
  formatAnalysisReport,
  normalizeWebsiteUrl
} from "./analysis-engine.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dataDirectory = resolve(process.env.DATA_DIR || join(root, "data"));
const databasePath = resolve(process.env.DATABASE_PATH || join(dataDirectory, "intelligence.sqlite"));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
const MAX_ACTIVE_JOBS = 2;
const MAX_JSON_BYTES = 64 * 1024;
const activeJobs = new Set();
const transientSources = new Map();
const staticFiles = new Map([
  ["/", ["poe-preview.html", "text/html; charset=utf-8"]],
  ["/poe-preview.html", ["poe-preview.html", "text/html; charset=utf-8"]],
  ["/poe-preview.css", ["poe-preview.css", "text/css; charset=utf-8"]],
  ["/poe-preview.js", ["poe-preview.js", "text/javascript; charset=utf-8"]]
]);

mkdirSync(dataDirectory, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS analyses (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    analysis_json TEXT,
    report TEXT
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    progress INTEGER NOT NULL,
    error TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS patterns (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS analysis_patterns (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    pattern_key TEXT NOT NULL REFERENCES patterns(key),
    PRIMARY KEY (analysis_id, pattern_key)
  );
  CREATE TABLE IF NOT EXISTS analysis_findings (
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    finding_id TEXT NOT NULL,
    PRIMARY KEY (analysis_id, finding_id)
  );
  CREATE TABLE IF NOT EXISTS feedback (
    analysis_id TEXT PRIMARY KEY REFERENCES analyses(id) ON DELETE CASCADE,
    usefulness INTEGER NOT NULL CHECK (usefulness BETWEEN 1 AND 5),
    accuracy INTEGER NOT NULL CHECK (accuracy BETWEEN 1 AND 5),
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS analyses_created_idx ON analyses(created_at DESC);
  CREATE INDEX IF NOT EXISTS jobs_analysis_idx ON jobs(analysis_id);
  CREATE INDEX IF NOT EXISTS analysis_patterns_key_idx ON analysis_patterns(pattern_key);
  CREATE INDEX IF NOT EXISTS analysis_findings_finding_idx ON analysis_findings(finding_id);
`);
database.prepare("UPDATE jobs SET status = 'failed', stage = 'interrupted', error = 'Server restarted before this job finished.', updated_at = ? WHERE status = 'running'")
  .run(new Date().toISOString());
database.prepare("UPDATE analyses SET status = 'failed' WHERE status = 'running'").run();

const statements = {
  insertAnalysis: database.prepare("INSERT INTO analyses (id, url, title, status, created_at) VALUES (?, ?, ?, 'running', ?)"),
  insertJob: database.prepare("INSERT INTO jobs (id, analysis_id, status, stage, progress, updated_at) VALUES (?, ?, 'running', 'initializing', 0, ?)"),
  updateJob: database.prepare("UPDATE jobs SET status = ?, stage = ?, progress = ?, error = ?, updated_at = ? WHERE id = ?"),
  updateAnalysis: database.prepare("UPDATE analyses SET title = ?, status = ?, completed_at = ?, analysis_json = ?, report = ? WHERE id = ?"),
  getJob: database.prepare(`
    SELECT jobs.id, jobs.analysis_id AS analysisId, jobs.status, jobs.stage,
      jobs.progress, jobs.error, analyses.url, analyses.title,
      analyses.analysis_json AS analysisJson, analyses.report
    FROM jobs JOIN analyses ON analyses.id = jobs.analysis_id WHERE jobs.id = ?
  `),
  getAnalysis: database.prepare("SELECT id, url, title, status, created_at AS createdAt, completed_at AS completedAt, analysis_json AS analysisJson, report FROM analyses WHERE id = ?"),
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
  insertAnalysisPattern: database.prepare("INSERT OR IGNORE INTO analysis_patterns (analysis_id, pattern_key) VALUES (?, ?)"),
  insertFinding: database.prepare("INSERT OR IGNORE INTO analysis_findings (analysis_id, finding_id) VALUES (?, ?)"),
  upsertFeedback: database.prepare(`
    INSERT INTO feedback (analysis_id, usefulness, accuracy, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id) DO UPDATE SET
      usefulness = excluded.usefulness, accuracy = excluded.accuracy,
      comment = excluded.comment, created_at = excluded.created_at
  `)
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
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
    request.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        reject(Object.assign(new Error("Request body exceeds 64 KB."), { status: 413 }));
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
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
  });
}

function loopbackHost(header) {
  if (!header || header.length > 255) return false;
  try {
    const parsed = new URL(`http://${header}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
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
      analysisId
    );
    for (const pattern of analysis.patterns) {
      const key = safePatternKey("design", pattern);
      statements.upsertPattern.run(key, pattern, "design", now, now);
      statements.insertAnalysisPattern.run(analysisId, key);
    }
    for (const technology of analysis.technologies) {
      const key = safePatternKey("technology", technology.name);
      statements.upsertPattern.run(key, technology.name, "technology", now, now);
      statements.insertAnalysisPattern.run(analysisId, key);
    }
    for (const finding of analysis.findings) {
      statements.insertFinding.run(analysisId, finding.id);
    }
  });
  transientSources.set(analysisId, sourceHtml);
  if (transientSources.size > 10) transientSources.delete(transientSources.keys().next().value);
}

function knownPatternsFor(analysis) {
  const keys = [
    ...analysis.patterns.map(value => safePatternKey("design", value)),
    ...analysis.technologies.map(value => safePatternKey("technology", value.name))
  ];
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(",");
  return database.prepare(`
    SELECT patterns.key, patterns.label, patterns.occurrences,
      ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS feedbackScore
    FROM patterns
    LEFT JOIN analysis_patterns ON analysis_patterns.pattern_key = patterns.key
    LEFT JOIN feedback ON feedback.analysis_id = analysis_patterns.analysis_id
    WHERE patterns.key IN (${placeholders})
    GROUP BY patterns.key
    ORDER BY COALESCE(feedbackScore, 0) DESC, patterns.occurrences DESC
    LIMIT 12
  `).all(...keys);
}

function historicalFindingScores(findings) {
  if (!findings.length) return new Map();
  const placeholders = findings.map(() => "?").join(",");
  const rows = database.prepare(`
    SELECT analysis_findings.finding_id AS findingId,
      ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS score,
      COUNT(feedback.analysis_id) AS ratings
    FROM analysis_findings
    JOIN feedback ON feedback.analysis_id = analysis_findings.analysis_id
    WHERE analysis_findings.finding_id IN (${placeholders})
    GROUP BY analysis_findings.finding_id
  `).all(...findings);
  return new Map(rows.map(row => [row.findingId, row]));
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
    feedback: row.usefulness == null ? null : {
      usefulness: row.usefulness,
      accuracy: row.accuracy
    }
  };
}

async function runAnalysis(jobId, analysisId, url, maxPages) {
  activeJobs.add(jobId);
  let currentStage = "validation";
  let currentProgress = 5;
  try {
    const analysis = await analyzeWebsite({
      url,
      maxPages,
      onStage: stage => {
        currentStage = stage.key;
        currentProgress = stage.progress;
        statements.updateJob.run("running", stage.key, stage.progress, null, new Date().toISOString(), jobId);
      }
    });
    const knownPatterns = knownPatternsFor(analysis);
    const findingScores = historicalFindingScores(analysis.findings.map(item => item.id));
    analysis.findings = analysis.findings.map(item => {
      const historical = findingScores.get(item.id);
      return {
        ...item,
        history: historical ? { feedbackScore: historical.score, ratings: historical.ratings } : null,
        relevance: historical ? Math.round((item.confidence * 70 + (historical.score / 5) * 30)) : Math.round(item.confidence * 100)
      };
    }).sort((left, right) => {
      const severityOrder = ["high", "medium", "low"];
      const severityDifference = severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity);
      return severityDifference || right.relevance - left.relevance;
    });
    const report = formatAnalysisReport(analysis, knownPatterns);
    currentStage = "storing";
    currentProgress = 96;
    statements.updateJob.run("running", "storing", 96, null, new Date().toISOString(), jobId);
    storeCompletedAnalysis(analysisId, analysis, report);
    statements.updateJob.run("complete", "complete", 100, null, new Date().toISOString(), jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The analysis failed.";
    console.error(`Website analysis ${analysisId} failed: ${message}`);
    statements.updateJob.run("failed", currentStage, currentProgress, message.slice(0, 500), new Date().toISOString(), jobId);
    database.prepare("UPDATE analyses SET status = 'failed', completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), analysisId);
  } finally {
    activeJobs.delete(jobId);
  }
}

function compareAnalyses(left, right) {
  const leftAnalysis = JSON.parse(left.analysisJson);
  const rightAnalysis = JSON.parse(right.analysisJson);
  const metricKeys = [...new Set([...Object.keys(leftAnalysis.counts), ...Object.keys(rightAnalysis.counts)])];
  return {
    left: { id: left.id, title: left.title, url: left.url },
    right: { id: right.id, title: right.title, url: right.url },
    metrics: metricKeys.map(key => ({
      name: key,
      left: leftAnalysis.counts[key] || 0,
      right: rightAnalysis.counts[key] || 0,
      change: (rightAnalysis.counts[key] || 0) - (leftAnalysis.counts[key] || 0)
    })),
    addedTechnologies: rightAnalysis.technologies.map(item => item.name)
      .filter(name => !leftAnalysis.technologies.some(item => item.name === name)),
    removedTechnologies: leftAnalysis.technologies.map(item => item.name)
      .filter(name => !rightAnalysis.technologies.some(item => item.name === name)),
    addedPatterns: rightAnalysis.patterns.filter(value => !leftAnalysis.patterns.includes(value)),
    removedPatterns: leftAnalysis.patterns.filter(value => !rightAnalysis.patterns.includes(value)),
    addedFindings: rightAnalysis.findings.filter(item => !leftAnalysis.findings.some(previous => previous.id === item.id)),
    resolvedFindings: leftAnalysis.findings.filter(item => !rightAnalysis.findings.some(next => next.id === item.id))
  };
}

async function handleApi(request, response, pathname, searchParams) {
  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, storage: "sqlite", learning: "rule-based retrieval" });
    return;
  }
  if (request.method === "GET" && pathname === "/api/history") {
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 20));
    sendJson(response, 200, { history: statements.getHistory.all(limit).map(serializeAnalysisRow) });
    return;
  }
  if (request.method === "GET" && pathname === "/api/knowledge") {
    const totals = database.prepare(`
      SELECT COUNT(*) AS analyses,
        (SELECT COALESCE(SUM(occurrences), 0) FROM patterns) AS observations,
        (SELECT COUNT(*) FROM patterns) AS uniquePatterns,
        (SELECT COUNT(*) FROM feedback) AS feedbackCount,
        (SELECT ROUND(AVG((usefulness + accuracy) / 2.0), 1) FROM feedback) AS averageFeedback
      FROM analyses WHERE status = 'complete'
    `).get();
    const patterns = database.prepare(`
      SELECT patterns.key, patterns.label, patterns.category, patterns.occurrences,
        patterns.last_seen AS lastSeen,
        ROUND(AVG((feedback.usefulness + feedback.accuracy) / 2.0), 1) AS feedbackScore,
        COUNT(feedback.analysis_id) AS ratings
      FROM patterns
      LEFT JOIN analysis_patterns ON analysis_patterns.pattern_key = patterns.key
      LEFT JOIN feedback ON feedback.analysis_id = analysis_patterns.analysis_id
      GROUP BY patterns.key ORDER BY patterns.occurrences DESC, patterns.label LIMIT 20
    `).all();
    const active = database.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'running'").get().count;
    sendJson(response, 200, {
      stats: { ...totals, activeJobs: active },
      patterns
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/analyses") {
    if (activeJobs.size >= MAX_ACTIVE_JOBS) {
      sendError(response, 429, "The analysis queue is full. Wait for a running analysis to finish.");
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
    const analysisId = randomUUID();
    const jobId = randomUUID();
    const now = new Date().toISOString();
    inTransaction(() => {
      statements.insertAnalysis.run(analysisId, url, new URL(url).hostname, now);
      statements.insertJob.run(jobId, analysisId, now);
    });
    runAnalysis(jobId, analysisId, url, maxPages);
    sendJson(response, 202, { jobId, analysisId });
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
      error: row.error
    };
    if (row.status === "complete") {
      result.report = row.report;
      result.analysis = JSON.parse(row.analysisJson);
      result.sourceHtml = transientSources.get(row.analysisId) || "";
    }
    sendJson(response, 200, result);
    return;
  }
  const compareMatch = pathname.match(/^\/api\/analyses\/([0-9a-f-]{36})\/compare$/i);
  if (request.method === "GET" && compareMatch) {
    const otherId = searchParams.get("against");
    const left = statements.getAnalysis.get(compareMatch[1]);
    const right = otherId && statements.getAnalysis.get(otherId);
    if (!left || !right || left.status !== "complete" || right.status !== "complete") {
      sendError(response, 404, "Both completed analyses are required for comparison.");
      return;
    }
    sendJson(response, 200, { comparison: compareAnalyses(left, right) });
    return;
  }
  const feedbackMatch = pathname.match(/^\/api\/analyses\/([0-9a-f-]{36})\/feedback$/i);
  if (request.method === "POST" && feedbackMatch) {
    const analysis = statements.getAnalysis.get(feedbackMatch[1]);
    if (!analysis || analysis.status !== "complete") {
      sendError(response, 404, "Completed analysis was not found.");
      return;
    }
    const body = await readJson(request);
    const usefulness = Number(body.usefulness);
    const accuracy = Number(body.accuracy);
    if (!Number.isInteger(usefulness) || usefulness < 1 || usefulness > 5 ||
        !Number.isInteger(accuracy) || accuracy < 1 || accuracy > 5) {
      sendError(response, 400, "Usefulness and accuracy ratings must be whole numbers from 1 to 5.");
      return;
    }
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 300) : "";
    database.prepare("INSERT INTO feedback (analysis_id, usefulness, accuracy, comment, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(analysis_id) DO UPDATE SET usefulness = excluded.usefulness, accuracy = excluded.accuracy, comment = excluded.comment, created_at = excluded.created_at")
      .run(analysis.id, usefulness, accuracy, comment, new Date().toISOString());
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
    const feedback = database.prepare("SELECT usefulness, accuracy, comment, created_at AS createdAt FROM feedback WHERE analysis_id = ?").get(row.id) || null;
    sendJson(response, 200, {
      id: row.id,
      url: row.url,
      title: row.title,
      createdAt: row.createdAt,
      analysis: JSON.parse(row.analysisJson),
      report: row.report,
      feedback
    });
    return;
  }
  sendError(response, 404, "API endpoint was not found.");
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    if (pathname.startsWith("/api/")) {
      if (!checkLocalRequest(request)) {
        sendError(response, 403, "This local analysis service only accepts same-origin requests.");
        return;
      }
      await handleApi(request, response, pathname, requestUrl.searchParams);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendError(response, 405, "Only GET and HEAD are supported for static files.");
      return;
    }
    const entry = staticFiles.get(pathname);
    if (!entry) {
      sendError(response, 404, "File was not found.");
      return;
    }
    const [fileName, contentType] = entry;
    const content = await import("node:fs/promises").then(fs => fs.readFile(join(root, fileName)));
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    const status = Number(error?.status) || (error instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error("Request failed:", error);
    sendError(response, status, status < 500 ? error.message : "The request could not be completed.");
  }
});

server.listen(port, host, () => {
  console.log(`Website intelligence engine listening at http://${host}:${port}`);
  console.log(`Persistent analysis database: ${databasePath}`);
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
