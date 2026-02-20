import { db } from "./index";
import { logger } from "../logger";
import type {
  CanonicalJob,
  RawJob,
  ScoreBandKey,
  TitleBucket,
  WorkMode,
  TimestampConfidence,
  JobStatus,
} from "../types";

// Run Log

export function createRun(runType: string, dryRun: boolean): number {
  const result = db.run(
    `INSERT INTO run_log (run_type, dry_run) VALUES (?, ?)`,
    [runType, dryRun ? 1 : 0],
  );
  return Number(result.lastInsertRowid);
}

export function finishRun(
  runId: number,
  status: string,
  stats: {
    sourcesAttempted: number;
    sourcesSucceeded: number;
    jobsFound: number;
    jobsNew: number;
    jobsDuplicate: number;
    errors: string[];
  },
): void {
  db.run(
    `UPDATE run_log SET
      finished_at = datetime('now'),
      status = ?,
      sources_attempted = ?,
      sources_succeeded = ?,
      jobs_found = ?,
      jobs_new = ?,
      jobs_duplicate = ?,
      errors = ?
    WHERE id = ?`,
    [
      status,
      stats.sourcesAttempted,
      stats.sourcesSucceeded,
      stats.jobsFound,
      stats.jobsNew,
      stats.jobsDuplicate,
      stats.errors.length > 0 ? JSON.stringify(stats.errors) : null,
      runId,
    ],
  );
}

// Raw Jobs

export function insertRawJob(job: RawJob, runId: number): number {
  const result = db.run(
    `INSERT INTO jobs_raw (source, company, raw_payload, run_id) VALUES (?, ?, ?, ?)`,
    [job.source, job.company, job.rawPayload, runId],
  );
  return Number(result.lastInsertRowid);
}

// Canonical Jobs

export function insertCanonicalJob(
  job: CanonicalJob,
  rawJobId: number,
): number {
  const result = db.run(
    `INSERT INTO jobs_canonical (
      title, company, source, source_job_id, url,
      city, province, country, location_raw, location_tier,
      work_mode, score, score_freshness, score_location, score_mode,
      score_band, posted_at, posted_at_confidence, original_timezone,
      first_seen_at, is_reposted, original_post_date,
      title_bucket, status, is_backfill, raw_job_id,
      url_hash, content_fingerprint
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )`,
    [
      job.title,
      job.company,
      job.source,
      job.sourceJobId,
      job.url,
      job.city,
      job.province,
      job.country,
      job.locationRaw,
      job.locationTier,
      job.workMode,
      job.score,
      job.scoreFreshness,
      job.scoreLocation,
      job.scoreMode,
      job.scoreBand,
      job.postedAt,
      job.postedAtConfidence,
      job.originalTimezone,
      job.firstSeenAt,
      job.isReposted ? 1 : 0,
      job.originalPostDate,
      job.titleBucket,
      job.status,
      job.isBackfill ? 1 : 0,
      rawJobId,
      job.urlHash,
      job.contentFingerprint,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getJobByUrlHash(urlHash: string): { id: number } | null {
  return db
    .query<
      { id: number },
      [string]
    >(`SELECT id FROM jobs_canonical WHERE url_hash = ?`)
    .get(urlHash);
}

export function getJobByContentFingerprint(
  fingerprint: string,
): { id: number; first_seen_at: string; posted_at: string | null } | null {
  return db
    .query<
      { id: number; first_seen_at: string; posted_at: string | null },
      [string]
    >(
      `SELECT id, first_seen_at, posted_at
       FROM jobs_canonical
       WHERE content_fingerprint = ? AND status = 'active'
       ORDER BY first_seen_at ASC
       LIMIT 1`,
    )
    .get(fingerprint);
}

interface CanonicalJobRow {
  id: number;
  title: string;
  company: string;
  source: string;
  url: string;
  city: string | null;
  location_tier: string | null;
  work_mode: string;
  score: number;
  score_freshness: number;
  score_location: number;
  score_mode: number;
  score_band: string;
  posted_at: string | null;
  first_seen_at: string;
  title_bucket: string;
  status: string;
}

export function getJobsByScore(
  options: {
    minScore?: number;
    maxScore?: number;
    tiers?: string[];
    titleBucket?: TitleBucket;
    status?: JobStatus;
    limit?: number;
    offset?: number;
    sinceDate?: string;
  } = {},
): CanonicalJobRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.status) {
    conditions.push("status = ?");
    params.push(options.status);
  } else {
    conditions.push("status = 'active'");
  }

  if (options.minScore !== undefined) {
    conditions.push("score >= ?");
    params.push(options.minScore);
  }

  if (options.maxScore !== undefined) {
    conditions.push("score <= ?");
    params.push(options.maxScore);
  }

  if (options.tiers && options.tiers.length > 0) {
    const placeholders = options.tiers.map(() => "?").join(", ");
    conditions.push(`location_tier IN (${placeholders})`);
    params.push(...options.tiers);
  }

  if (options.titleBucket) {
    conditions.push("title_bucket = ?");
    params.push(options.titleBucket);
  }

  if (options.sinceDate) {
    conditions.push("first_seen_at >= ?");
    params.push(options.sinceDate);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return db
    .query<CanonicalJobRow, (string | number)[]>(
      `SELECT id, title, company, source, url, city, location_tier,
              work_mode, score, score_freshness, score_location, score_mode,
              score_band, posted_at, first_seen_at, title_bucket, status
       FROM jobs_canonical
       ${whereClause}
       ORDER BY score DESC, first_seen_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...[...params, limit, offset]);
}

export function getJobById(id: number): CanonicalJobRow | null {
  return db
    .query<CanonicalJobRow, [number]>(
      `SELECT id, title, company, source, url, city, location_tier,
              work_mode, score, score_freshness, score_location, score_mode,
              score_band, posted_at, first_seen_at, title_bucket, status
       FROM jobs_canonical WHERE id = ?`,
    )
    .get(id);
}

export function updateJobScore(
  jobId: number,
  score: number,
  scoreFreshness: number,
  scoreLocation: number,
  scoreMode: number,
  scoreBand: ScoreBandKey,
): void {
  db.run(
    `UPDATE jobs_canonical SET
      score = ?, score_freshness = ?, score_location = ?,
      score_mode = ?, score_band = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [score, scoreFreshness, scoreLocation, scoreMode, scoreBand, jobId],
  );
}

// Applications

export function markJobApplied(jobId: number): void {
  // Check if already tracked
  const existing = db
    .query<
      { id: number },
      [number]
    >(`SELECT id FROM applications WHERE job_id = ?`)
    .get(jobId);

  if (existing) {
    db.run(
      `UPDATE applications SET status = 'applied', updated_at = datetime('now') WHERE job_id = ?`,
      [jobId],
    );
  } else {
    db.run(`INSERT INTO applications (job_id, status) VALUES (?, 'applied')`, [
      jobId,
    ]);
  }

  db.run(
    `UPDATE jobs_canonical
     SET status = 'applied', updated_at = datetime('now')
     WHERE id = ?`,
    [jobId],
  );
}

export function markJobDismissed(jobId: number): void {
  const existing = db
    .query<
      { id: number },
      [number]
    >(`SELECT id FROM applications WHERE job_id = ?`)
    .get(jobId);

  if (existing) {
    db.run(
      `UPDATE applications SET status = 'dismissed', outcome = 'skipped', updated_at = datetime('now') WHERE job_id = ?`,
      [jobId],
    );
  } else {
    db.run(
      `INSERT INTO applications (job_id, status, outcome) VALUES (?, 'dismissed', 'skipped')`,
      [jobId],
    );
  }

  db.run(
    `UPDATE jobs_canonical
     SET status = 'dismissed', updated_at = datetime('now')
     WHERE id = ?`,
    [jobId],
  );
}

// Duplicates

export function insertDuplicateLink(
  jobIdA: number,
  jobIdB: number,
  matchMethod: string,
  similarityScore: number,
  isPotentialDuplicate: boolean,
): void {
  db.run(
    `INSERT INTO job_duplicates (job_id_a, job_id_b, match_method, similarity_score, potential_duplicate)
     VALUES (?, ?, ?, ?, ?)`,
    [
      jobIdA,
      jobIdB,
      matchMethod,
      similarityScore,
      isPotentialDuplicate ? 1 : 0,
    ],
  );
}

// Notifications

export function logNotification(
  botType: string,
  messageType: string,
  jobId: number | null,
  messageText: string,
  telegramMessageId: string | null,
  success: boolean,
  errorMessage: string | null,
): void {
  db.run(
    `INSERT INTO notifications (bot_type, message_type, job_id, message_text, telegram_message_id, success, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      botType,
      messageType,
      jobId,
      messageText,
      telegramMessageId,
      success ? 1 : 0,
      errorMessage,
    ],
  );
}

// Alerts Retry Queue

export function queueAlertRetry(
  botType: string,
  messageType: string,
  jobId: number | null,
  messageText: string,
  error: string,
): void {
  db.run(
    `INSERT INTO alerts_retry_queue (bot_type, message_type, job_id, message_text, last_error, next_retry_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+5 minutes'))`,
    [botType, messageType, jobId, messageText, error],
  );
}

export function getPendingRetryAlerts(): Array<{
  id: number;
  bot_type: string;
  message_type: string;
  job_id: number | null;
  message_text: string;
  retry_count: number;
}> {
  return db
    .query<
      {
        id: number;
        bot_type: string;
        message_type: string;
        job_id: number | null;
        message_text: string;
        retry_count: number;
      },
      []
    >(
      `SELECT id, bot_type, message_type, job_id, message_text, retry_count
       FROM alerts_retry_queue
       WHERE next_retry_at <= datetime('now') AND retry_count < max_retries
       ORDER BY created_at ASC`,
    )
    .all();
}

export function removeRetryAlert(id: number): void {
  db.run(`DELETE FROM alerts_retry_queue WHERE id = ?`, [id]);
}

export function incrementRetryCount(id: number, error: string): void {
  db.run(
    `UPDATE alerts_retry_queue SET
      retry_count = retry_count + 1,
      last_error = ?,
      next_retry_at = datetime('now', '+' || (5 * (retry_count + 1)) || ' minutes')
    WHERE id = ?`,
    [error, id],
  );
}

export function getRetryQueueSize(): number {
  const result = db
    .query<
      { count: number },
      []
    >(`SELECT COUNT(*) as count FROM alerts_retry_queue`)
    .get();
  return result?.count ?? 0;
}

// Source Metrics

export function updateSourceMetrics(
  source: string,
  stats: {
    jobsFound: number;
    jobsNew: number;
    jobsDuplicate: number;
    parseFailures: number;
    rateLimitHits: number;
    responseTimeAvgMs: number;
  },
): void {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });

  db.run(
    `INSERT INTO source_metrics (source, date, jobs_found, jobs_new, jobs_duplicate, parse_failures, rate_limit_hits, response_time_avg_ms, success_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, date) DO UPDATE SET
       jobs_found = jobs_found + excluded.jobs_found,
       jobs_new = jobs_new + excluded.jobs_new,
       jobs_duplicate = jobs_duplicate + excluded.jobs_duplicate,
       parse_failures = parse_failures + excluded.parse_failures,
       rate_limit_hits = rate_limit_hits + excluded.rate_limit_hits,
       response_time_avg_ms = excluded.response_time_avg_ms`,
    [
      source,
      today,
      stats.jobsFound,
      stats.jobsNew,
      stats.jobsDuplicate,
      stats.parseFailures,
      stats.rateLimitHits,
      stats.responseTimeAvgMs,
      stats.jobsFound > 0
        ? (stats.jobsFound - stats.parseFailures) / stats.jobsFound
        : 0,
    ],
  );
}

// Connector Checkpoints

export function getConnectorCheckpoint(
  source: string,
): { last_success_at: string | null; error_count_consecutive: number } | null {
  return db
    .query<
      { last_success_at: string | null; error_count_consecutive: number },
      [string]
    >(`SELECT last_success_at, error_count_consecutive FROM connector_checkpoints WHERE source = ?`)
    .get(source);
}

export function updateConnectorCheckpoint(
  source: string,
  success: boolean,
  jobCount: number,
): void {
  if (success) {
    db.run(
      `INSERT INTO connector_checkpoints (source, last_success_at, last_job_count, error_count_consecutive, updated_at)
       VALUES (?, datetime('now'), ?, 0, datetime('now'))
       ON CONFLICT(source) DO UPDATE SET
         last_success_at = datetime('now'),
         last_job_count = excluded.last_job_count,
         error_count_consecutive = 0,
         updated_at = datetime('now')`,
      [source, jobCount],
    );
  } else {
    db.run(
      `INSERT INTO connector_checkpoints (source, error_count_consecutive, updated_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(source) DO UPDATE SET
         error_count_consecutive = error_count_consecutive + 1,
         updated_at = datetime('now')`,
      [source],
    );
  }
}

// Unsent Jobs (for digest)

export function getUndigestedJobs(
  sinceDate: string,
  includeAlreadyDigested: boolean = false,
): CanonicalJobRow[] {
  const dedupClause = includeAlreadyDigested
    ? ""
    : `AND id NOT IN (
         SELECT DISTINCT n.job_id FROM notifications n
         WHERE n.message_type IN ('morning_digest', 'evening_digest')
           AND n.success = 1
           AND n.job_id IS NOT NULL
       )`;

  return db
    .query<CanonicalJobRow, [string]>(
      `SELECT id, title, company, source, url, city, location_tier,
              work_mode, score, score_freshness, score_location, score_mode,
              score_band, posted_at, first_seen_at, title_bucket, status
       FROM jobs_canonical
       WHERE title_bucket IN ('include', 'maybe')
         AND status = 'active'
         AND first_seen_at >= ?
         ${dedupClause}
       ORDER BY score DESC, first_seen_at DESC`,
    )
    .all(sinceDate);
}

// Fuzzy Dedup Lookup

export function getRecentJobsForFuzzyDedup(
  daysBack: number = 30,
): Array<{ id: number; company: string; title: string; city: string | null }> {
  return db
    .query<
      { id: number; company: string; title: string; city: string | null },
      [number]
    >(
      `SELECT id, company, title, city
       FROM jobs_canonical
       WHERE status = 'active'
         AND first_seen_at >= datetime('now', '-' || ? || ' days')`,
    )
    .all(daysBack);
}

// Discovery Boards

export interface DiscoveredBoard {
  id: number;
  platform:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workable"
    | "smartrecruiters"
    | "bamboohr"
    | "workday"
    | "icims";
  board_url: string;
  board_slug: string | null;
  company_guess: string | null;
}

export function upsertDiscoveredBoard(input: {
  platform:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workable"
    | "smartrecruiters"
    | "bamboohr"
    | "workday"
    | "icims";
  boardUrl: string;
  boardSlug: string | null;
  companyGuess: string | null;
  confidence: number;
  discoveredVia?: string;
}): void {
  db.run(
    `INSERT INTO discovered_boards (
      platform, board_url, board_slug, company_guess, confidence, discovered_via
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(board_url) DO UPDATE SET
      board_slug = COALESCE(excluded.board_slug, discovered_boards.board_slug),
      company_guess = COALESCE(excluded.company_guess, discovered_boards.company_guess),
      confidence = CASE
        WHEN excluded.confidence > discovered_boards.confidence THEN excluded.confidence
        ELSE discovered_boards.confidence
      END,
      status = 'active',
      last_seen_at = datetime('now')`,
    [
      input.platform,
      input.boardUrl,
      input.boardSlug,
      input.companyGuess,
      input.confidence,
      input.discoveredVia ?? "cse",
    ],
  );
}

export function getActiveDiscoveredBoards(
  platform:
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workable"
    | "smartrecruiters"
    | "bamboohr"
    | "workday"
    | "icims",
): DiscoveredBoard[] {
  return db
    .query<DiscoveredBoard, [string]>(
      `SELECT id, platform, board_url, board_slug, company_guess
       FROM discovered_boards
       WHERE platform = ? AND status = 'active'
       ORDER BY confidence DESC, last_seen_at DESC`,
    )
    .all(platform);
}

export function updateBoardPollState(
  boardId: number,
  success: boolean,
  jobCount: number,
  cursor: string | null = null,
): void {
  if (success && jobCount > 0) {
    db.run(
      `INSERT INTO board_poll_state (board_id, last_success_at, last_cursor, consecutive_zero_runs, updated_at)
       VALUES (?, datetime('now'), ?, 0, datetime('now'))
       ON CONFLICT(board_id) DO UPDATE SET
         last_success_at = datetime('now'),
         last_cursor = COALESCE(excluded.last_cursor, board_poll_state.last_cursor),
         consecutive_zero_runs = 0,
         updated_at = datetime('now')`,
      [boardId, cursor],
    );
    return;
  }

  db.run(
    `INSERT INTO board_poll_state (board_id, consecutive_zero_runs, updated_at)
     VALUES (?, 1, datetime('now'))
     ON CONFLICT(board_id) DO UPDATE SET
       consecutive_zero_runs = consecutive_zero_runs + 1,
       updated_at = datetime('now')`,
    [boardId],
  );
}

// URL Expiry Cleanup

export interface ActiveJobForValidation {
  id: number;
  url: string;
}

export function getActiveJobsForValidation(
  daysBack: number,
): ActiveJobForValidation[] {
  return db
    .query<ActiveJobForValidation, [number]>(
      `SELECT id, url
       FROM jobs_canonical
       WHERE status = 'active'
         AND first_seen_at >= datetime('now', '-' || ? || ' days')`,
    )
    .all(daysBack);
}

export function markJobExpired(jobId: number): void {
  db.run(
    `UPDATE jobs_canonical
     SET status = 'expired', updated_at = datetime('now')
     WHERE id = ?`,
    [jobId],
  );
}

// Last Successful Run Time

export function getLastSuccessfulRunTime(): string | null {
  const result = db
    .query<
      { finished_at: string },
      []
    >(`SELECT finished_at FROM run_log WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`)
    .get();
  return result?.finished_at ?? null;
}

// Archive Old Jobs

export function archiveOldJobs(): { archived: number; purged: number } {
  const archiveResult = db.run(`
    UPDATE jobs_canonical
    SET status = 'archived', archived_at = datetime('now')
    WHERE status = 'active'
    AND first_seen_at < datetime('now', '-30 days')
  `);
  logger.info(`Archived ${archiveResult.changes} jobs older than 30 days`);

  const purgeResult = db.run(`
    DELETE FROM jobs_raw
    WHERE fetched_at < datetime('now', '-90 days')
  `);
  logger.info(
    `Purged ${purgeResult.changes} raw data entries older than 90 days`,
  );

  return { archived: archiveResult.changes, purged: purgeResult.changes };
}

// Raw Replay

export interface RawReplayRow {
  id: number;
  source: string;
  company: string | null;
  raw_payload: string;
  fetched_at: string;
}

export function getRawJobsForReplay(
  date: string,
  source: string,
): RawReplayRow[] {
  return db
    .query<RawReplayRow, [string, string]>(
      `SELECT id, source, company, raw_payload, fetched_at
       FROM jobs_raw
       WHERE source = ?
         AND date(fetched_at) = ?
       ORDER BY fetched_at ASC`,
    )
    .all(source, date);
}

// AI Fit Analysis

import type { FitAnalysis, FitAnalysisRow } from "../ai/types";

export function insertFitAnalysis(
  canonicalJobId: number,
  analysis: FitAnalysis,
): number {
  const result = db.run(
    `INSERT OR REPLACE INTO job_fit_analysis (
      canonical_job_id, fit_score, verdict, summary,
      strengths_json, gaps_json, recommendation,
      skills_matched_json, skills_missing_json, skills_bonus_json,
      experience_level_match, domain_relevance,
      resume_tailoring_tips_json, cover_letter_points_json,
      model_used, provider, prompt_tokens, completion_tokens
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      canonicalJobId,
      analysis.fitScore,
      analysis.verdict,
      analysis.summary,
      JSON.stringify(analysis.strengths),
      JSON.stringify(analysis.gaps),
      analysis.recommendation,
      JSON.stringify(analysis.keySkillsMatched),
      JSON.stringify(analysis.keySkillsMissing),
      JSON.stringify(analysis.keySkillsBonus),
      analysis.experienceLevelMatch,
      analysis.domainRelevance,
      JSON.stringify(analysis.resumeTailoringTips),
      JSON.stringify(analysis.coverLetterPoints),
      analysis.modelUsed,
      analysis.provider,
      analysis.promptTokens,
      analysis.completionTokens,
    ],
  );
  return Number(result.lastInsertRowid);
}

export function getFitAnalysis(canonicalJobId: number): FitAnalysisRow | null {
  return (
    db
      .query<
        FitAnalysisRow,
        [number]
      >(`SELECT * FROM job_fit_analysis WHERE canonical_job_id = ?`)
      .get(canonicalJobId) ?? null
  );
}

// Alternate Job URLs

export function insertAlternateUrl(
  canonicalJobId: number,
  alternateUrl: string,
  alternateSource: string,
): void {
  db.run(
    `INSERT OR IGNORE INTO job_alternate_urls (canonical_job_id, alternate_url, alternate_source)
     VALUES (?, ?, ?)`,
    [canonicalJobId, alternateUrl, alternateSource],
  );
}

export function getAlternateUrls(
  jobId: number,
): Array<{ url: string; source: string }> {
  return db
    .query<{ url: string; source: string }, [number]>(
      `SELECT alternate_url as url, alternate_source as source
       FROM job_alternate_urls
       WHERE canonical_job_id = ?
       ORDER BY created_at ASC
       LIMIT 5`,
    )
    .all(jobId);
}

// Resume/Recovery

export interface JobNeedingAnalysis {
  id: number;
  title: string;
  company: string;
  source: string;
  url: string;
  city: string | null;
  work_mode: string;
  score: number;
  score_band: string;
  posted_at: string | null;
  first_seen_at: string;
  title_bucket: string;
}

export function getJobsNeedingAnalysis(minScore: number): JobNeedingAnalysis[] {
  return db
    .query<JobNeedingAnalysis, [number]>(
      `SELECT jc.id, jc.title, jc.company, jc.source, jc.url, jc.city,
              jc.work_mode, jc.score, jc.score_band, jc.posted_at,
              jc.first_seen_at, jc.title_bucket
       FROM jobs_canonical jc
       WHERE jc.status = 'active'
         AND jc.is_backfill = 0
         AND jc.score >= ?
         AND jc.title_bucket = 'include'
         AND NOT EXISTS (
           SELECT 1 FROM job_fit_analysis jfa WHERE jfa.canonical_job_id = jc.id
         )
       ORDER BY jc.score DESC, jc.first_seen_at DESC`,
    )
    .all(minScore);
}

export interface JobNeedingAlert {
  id: number;
  title: string;
  company: string;
  source: string;
  url: string;
  city: string | null;
  work_mode: string;
  score: number;
  score_band: string;
  posted_at: string | null;
  first_seen_at: string;
}

export function getJobsNeedingAlerts(): JobNeedingAlert[] {
  return db
    .query<JobNeedingAlert, []>(
      `SELECT jc.id, jc.title, jc.company, jc.source, jc.url, jc.city,
              jc.work_mode, jc.score, jc.score_band, jc.posted_at,
              jc.first_seen_at
       FROM jobs_canonical jc
       WHERE jc.status = 'active'
         AND jc.is_backfill = 0
         AND jc.score_band = 'topPriority'
         AND jc.title_bucket = 'include'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.job_id = jc.id
             AND n.message_type = 'instant_alert'
             AND n.success = 1
         )
       ORDER BY jc.score DESC, jc.first_seen_at DESC`,
    )
    .all();
}

export function getRawJobContent(canonicalJobId: number): string | null {
  const result = db
    .query<{ raw_payload: string }, [number]>(
      `SELECT jr.raw_payload
       FROM jobs_raw jr
       INNER JOIN jobs_canonical jc ON jc.raw_job_id = jr.id
        WHERE jc.id = ?`,
    )
    .get(canonicalJobId);
  return result?.raw_payload ?? null;
}

// Analytics

export interface SourceAnalytics {
  source: string;
  totalJobs: number;
  totalNew: number;
  totalDuplicates: number;
  totalParseFailures: number;
  totalApplied: number;
  avgResponseTimeMs: number;
  successRate: number;
  duplicateRate: number;
  parseFailureRate: number;
  applyConversionRate: number;
}

export function getSourceAnalytics(days: number = 7): SourceAnalytics[] {
  return db
    .query<SourceAnalytics, [number, number, number]>(
      `SELECT 
        sm.source as source,
        SUM(sm.jobs_found) as totalJobs,
        SUM(sm.jobs_new) as totalNew,
        SUM(sm.jobs_duplicate) as totalDuplicates,
        SUM(sm.parse_failures) as totalParseFailures,
        AVG(sm.response_time_avg_ms) as avgResponseTimeMs,
        AVG(sm.success_rate) as successRate,
        COALESCE((
          SELECT COUNT(*)
          FROM applications a
          INNER JOIN jobs_canonical jc ON jc.id = a.job_id
          WHERE a.status = 'applied'
            AND jc.source = sm.source
            AND a.applied_at >= datetime('now', '-' || ? || ' days')
        ), 0) as totalApplied,
        CASE
          WHEN SUM(jobs_found) > 0 
          THEN CAST(SUM(jobs_duplicate) AS REAL) / SUM(jobs_found)
          ELSE 0 
        END as duplicateRate,
        CASE
          WHEN SUM(sm.jobs_found) > 0
          THEN CAST(SUM(sm.parse_failures) AS REAL) / SUM(sm.jobs_found)
          ELSE 0
        END as parseFailureRate,
        CASE
          WHEN SUM(sm.jobs_found) > 0
          THEN CAST(COALESCE((
            SELECT COUNT(*)
            FROM applications a
            INNER JOIN jobs_canonical jc ON jc.id = a.job_id
            WHERE a.status = 'applied'
              AND jc.source = sm.source
              AND a.applied_at >= datetime('now', '-' || ? || ' days')
          ), 0) AS REAL) / SUM(sm.jobs_found)
          ELSE 0
        END as applyConversionRate
       FROM source_metrics sm
       WHERE sm.date >= date('now', '-' || ? || ' days')
       GROUP BY sm.source
       ORDER BY totalNew DESC`,
    )
    .all(days, days, days);
}

export interface WeeklySummary {
  totalJobs: number;
  totalNew: number;
  totalApplied: number;
  totalDismissed: number;
  bySource: Array<{ source: string; count: number }>;
  byScoreBand: Array<{ band: string; count: number }>;
  topLocations: Array<{ city: string; count: number }>;
}

export function getWeeklySummary(): WeeklySummary {
  const totalJobs =
    db
      .query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM jobs_canonical 
       WHERE first_seen_at >= datetime('now', '-' || ? || ' days')`,
      )
      .get(7)?.count ?? 0;

  const totalNew =
    db
      .query<{ count: number }, [number]>(
        `SELECT COUNT(*) as count FROM jobs_canonical 
       WHERE first_seen_at >= datetime('now', '-' || ? || ' days') AND is_backfill = 0`,
      )
      .get(7)?.count ?? 0;

  const appliedResult = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM applications 
       WHERE applied_at >= datetime('now', '-7 days') AND status = 'applied'`,
    )
    .get();
  const totalApplied = appliedResult?.count ?? 0;

  const dismissedResult = db
    .query<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM applications 
       WHERE applied_at >= datetime('now', '-7 days') AND status = 'dismissed'`,
    )
    .get();
  const totalDismissed = dismissedResult?.count ?? 0;

  const bySource = db
    .query<{ source: string; count: number }, []>(
      `SELECT source, COUNT(*) as count 
       FROM jobs_canonical 
       WHERE first_seen_at >= datetime('now', '-7 days')
       GROUP BY source 
       ORDER BY count DESC 
       LIMIT 10`,
    )
    .all();

  const byScoreBand = db
    .query<{ band: string; count: number }, []>(
      `SELECT score_band as band, COUNT(*) as count 
       FROM jobs_canonical 
       WHERE first_seen_at >= datetime('now', '-7 days')
       GROUP BY score_band 
       ORDER BY count DESC`,
    )
    .all();

  const topLocations = db
    .query<{ city: string; count: number }, []>(
      `SELECT city, COUNT(*) as count 
       FROM jobs_canonical 
       WHERE first_seen_at >= datetime('now', '-7 days')
         AND city IS NOT NULL AND city != ''
       GROUP BY city 
       ORDER BY count DESC 
       LIMIT 10`,
    )
    .all();

  return {
    totalJobs,
    totalNew,
    totalApplied,
    totalDismissed,
    bySource,
    byScoreBand,
    topLocations,
  };
}
