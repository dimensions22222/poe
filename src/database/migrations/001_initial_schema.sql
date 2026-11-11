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

CREATE TABLE IF NOT EXISTS monitored_sites (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  max_pages INTEGER NOT NULL,
  interval_hours INTEGER NOT NULL,
  next_run_at TEXT NOT NULL,
  last_run_at TEXT,
  last_analysis_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analyses_created_idx ON analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_analysis_idx ON jobs(analysis_id);
CREATE INDEX IF NOT EXISTS analysis_patterns_key_idx ON analysis_patterns(pattern_key);
CREATE INDEX IF NOT EXISTS analysis_findings_finding_idx ON analysis_findings(finding_id);
