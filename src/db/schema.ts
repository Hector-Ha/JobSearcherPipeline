export const SCHEMA_VERSION = 2;

export const CREATE_TABLES_SQL = `
  -- 1. run_log (created first — referenced by jobs_raw and connector_retry_queue)
  CREATE TABLE IF NOT EXISTS run_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT,
    status TEXT DEFAULT 'running',
    sources_attempted INTEGER DEFAULT 0,
    sources_succeeded INTEGER DEFAULT 0,
    jobs_found INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    jobs_duplicate INTEGER DEFAULT 0,
    errors TEXT,
    dry_run INTEGER DEFAULT 0
  );

  -- 2. jobs_raw
  CREATE TABLE IF NOT EXISTS jobs_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    company TEXT,
    raw_payload TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    run_id INTEGER,
    FOREIGN KEY (run_id) REFERENCES run_log(id)
  );

  -- 3. jobs_canonical
  CREATE TABLE IF NOT EXISTS jobs_canonical (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    source TEXT NOT NULL,
    source_job_id TEXT,
    url TEXT NOT NULL,
    city TEXT,
    province TEXT,
    country TEXT DEFAULT 'Canada',
    location_raw TEXT,
    location_tier TEXT,
    work_mode TEXT DEFAULT 'unknown',
    score INTEGER DEFAULT 0,
    score_freshness INTEGER DEFAULT 0,
    score_location INTEGER DEFAULT 0,
    score_mode INTEGER DEFAULT 0,
    score_band TEXT,
    posted_at TEXT,
    posted_at_confidence TEXT DEFAULT 'low',
    original_timezone TEXT,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_reposted INTEGER DEFAULT 0,
    original_post_date TEXT,
    title_bucket TEXT DEFAULT 'include',
    status TEXT DEFAULT 'active',
    archived_at TEXT,
    is_backfill INTEGER DEFAULT 0,
    raw_job_id INTEGER,
    url_hash TEXT,
    content_fingerprint TEXT,
    FOREIGN KEY (raw_job_id) REFERENCES jobs_raw(id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_url_hash ON jobs_canonical(url_hash);
  CREATE INDEX IF NOT EXISTS idx_canonical_source ON jobs_canonical(source);
  CREATE INDEX IF NOT EXISTS idx_canonical_status ON jobs_canonical(status);
  CREATE INDEX IF NOT EXISTS idx_canonical_score ON jobs_canonical(score DESC);
  CREATE INDEX IF NOT EXISTS idx_canonical_first_seen ON jobs_canonical(first_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_canonical_title_bucket ON jobs_canonical(title_bucket);

  -- 4. job_duplicates
  CREATE TABLE IF NOT EXISTS job_duplicates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id_a INTEGER NOT NULL,
    job_id_b INTEGER NOT NULL,
    match_method TEXT NOT NULL,
    similarity_score REAL,
    potential_duplicate INTEGER DEFAULT 0,
    user_confirmed INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id_a) REFERENCES jobs_canonical(id),
    FOREIGN KEY (job_id_b) REFERENCES jobs_canonical(id)
  );

  -- 5. applications
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    status TEXT DEFAULT 'applied',
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT,
    outcome TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs_canonical(id)
  );

  -- 6. notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_type TEXT NOT NULL DEFAULT 'job',
    message_type TEXT NOT NULL,
    job_id INTEGER,
    message_text TEXT NOT NULL,
    telegram_message_id TEXT,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    success INTEGER DEFAULT 1,
    error_message TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs_canonical(id)
  );

  -- 7. alerts_retry_queue
  CREATE TABLE IF NOT EXISTS alerts_retry_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_type TEXT NOT NULL DEFAULT 'job',
    message_type TEXT NOT NULL,
    job_id INTEGER,
    message_text TEXT NOT NULL,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    next_retry_at TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs_canonical(id)
  );

  -- 8. connector_retry_queue
  CREATE TABLE IF NOT EXISTS connector_retry_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    company TEXT,
    timeout_ms INTEGER,
    retry_timeout_ms INTEGER DEFAULT 60000,
    error_message TEXT,
    run_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    retried_at TEXT,
    retry_success INTEGER,
    FOREIGN KEY (run_id) REFERENCES run_log(id)
  );

  -- 9. source_metrics
  CREATE TABLE IF NOT EXISTS source_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    date TEXT NOT NULL,
    jobs_found INTEGER DEFAULT 0,
    jobs_new INTEGER DEFAULT 0,
    jobs_duplicate INTEGER DEFAULT 0,
    parse_failures INTEGER DEFAULT 0,
    rate_limit_hits INTEGER DEFAULT 0,
    rate_limit_adjustment REAL,
    response_time_avg_ms INTEGER,
    success_rate REAL,
    rolling_7day_avg REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, date)
  );

  -- 10. connector_checkpoints
  CREATE TABLE IF NOT EXISTS connector_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL UNIQUE,
    company TEXT,
    last_success_at TEXT,
    last_cursor TEXT,
    last_job_count INTEGER,
    error_count_consecutive INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- 11. schema_fingerprints
  CREATE TABLE IF NOT EXISTS schema_fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    fingerprint_type TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    sample_url TEXT,
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_current INTEGER DEFAULT 1,
    UNIQUE(source, fingerprint_type)
  );

  -- 12. cse_key_usage
  CREATE TABLE IF NOT EXISTS cse_key_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_index INTEGER NOT NULL,
    date TEXT NOT NULL,
    queries_used INTEGER DEFAULT 0,
    queries_limit INTEGER DEFAULT 100,
    last_used_at TEXT,
    hit_limit INTEGER DEFAULT 0,
    UNIQUE(key_index, date)
  );

  -- 13. job_fit_analysis
  CREATE TABLE IF NOT EXISTS job_fit_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_job_id INTEGER NOT NULL UNIQUE,
    fit_score INTEGER,
    verdict TEXT,
    summary TEXT,
    strengths_json TEXT,
    gaps_json TEXT,
    recommendation TEXT,
    skills_matched_json TEXT,
    skills_missing_json TEXT,
    skills_bonus_json TEXT,
    experience_level_match TEXT,
    domain_relevance TEXT,
    resume_tailoring_tips_json TEXT,
    cover_letter_points_json TEXT,
    model_used TEXT,
    provider TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    analyzed_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (canonical_job_id) REFERENCES jobs_canonical(id)
  );

  CREATE INDEX IF NOT EXISTS idx_fit_analysis_job ON job_fit_analysis(canonical_job_id);
  CREATE INDEX IF NOT EXISTS idx_fit_analysis_score ON job_fit_analysis(fit_score DESC);
`;
