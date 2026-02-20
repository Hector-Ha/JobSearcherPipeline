import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import {
  getJobsNeedingAnalysis,
  getJobsNeedingAlerts,
  getRawJobContent,
  insertFitAnalysis,
} from "../db/operations";
import { analyzeFit, getModalKeyCount, initKeyPool } from "../ai";
import { sendJobAlert, initAlerts } from "../alerts";
import type { CanonicalJob, WorkMode, ScoreBandKey, TitleBucket } from "../types";

const args = process.argv.slice(2);
const analyzeOnly = args.includes("--analyze-only");
const alertsOnly = args.includes("--alerts-only");

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }

    const promise = processor(item)
      .then((result) => {
        results.push(result);
      })
      .catch((error) => {
        logger.error(`runWithConcurrency item failed: ${error}`);
      })
      .finally(() => {
        const index = executing.indexOf(promise);
        if (index > -1) executing.splice(index, 1);
      });

    executing.push(promise);
  }

  await Promise.all(executing);
  return results;
}

function buildCanonicalJob(job: {
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
}): CanonicalJob {
  return {
    title: job.title,
    company: job.company,
    source: job.source,
    sourceJobId: "",
    url: job.url,
    city: job.city,
    province: null,
    country: "Canada",
    locationRaw: "",
    locationTier: null,
    workMode: job.work_mode as WorkMode,
    score: job.score,
    scoreFreshness: 0,
    scoreLocation: 0,
    scoreMode: 0,
    scoreBand: job.score_band as ScoreBandKey,
    postedAt: job.posted_at,
    postedAtConfidence: "low",
    originalTimezone: null,
    firstSeenAt: job.first_seen_at,
    isReposted: false,
    originalPostDate: null,
    titleBucket: job.title_bucket as TitleBucket,
    status: "active",
    isBackfill: false,
    urlHash: "",
    contentFingerprint: "",
  };
}

async function main() {
  logger.info("═══════════════════════════════════════════════════");
  logger.info("  Resume Analysis — Recover Interrupted Pipeline");
  logger.info("═══════════════════════════════════════════════════");

  const config = loadConfig();
  initializeDatabase();
  initKeyPool(config);

  initAlerts({
    telegramBotToken: config.env.telegramBotToken,
    telegramChatId: config.env.telegramChatId,
    telegramLogBotToken: config.env.telegramLogBotToken,
    telegramLogChatId: config.env.telegramLogChatId,
    dryRun: config.env.dryRun,
  });

  const concurrency = Math.max(1, getModalKeyCount());
  let totalAnalyzed = 0;
  let totalAlerts = 0;

  // Phase 1: Resume AI Analysis
  if (!alertsOnly) {
    const jobsNeedingAnalysis = getJobsNeedingAnalysis(config.env.aiAnalysisMinScore);
    
    if (jobsNeedingAnalysis.length === 0) {
      logger.info("No jobs need AI analysis — all caught up!");
    } else {
      logger.info(
        `Found ${jobsNeedingAnalysis.length} jobs needing AI analysis (concurrency: ${concurrency})`,
      );

      const analysisResults = await runWithConcurrency(
        jobsNeedingAnalysis,
        concurrency,
        async (job) => {
          const rawContent = getRawJobContent(job.id);
          if (!rawContent) {
            logger.warn(`No raw content for job ${job.id} — skipping`);
            return { job, fitAnalysis: null };
          }

          const canonicalJob = buildCanonicalJob(job);
          const fitAnalysis = await analyzeFit(canonicalJob, rawContent, config);

          if (fitAnalysis) {
            insertFitAnalysis(job.id, fitAnalysis);
          }

          return { job, fitAnalysis };
        },
      );

      totalAnalyzed = analysisResults.filter(r => r.fitAnalysis).length;
      logger.info(`AI analysis complete: ${totalAnalyzed}/${jobsNeedingAnalysis.length} jobs analyzed`);
    }
  }

  // Phase 2: Send Missed Alerts
  if (!analyzeOnly) {
    const jobsNeedingAlerts = getJobsNeedingAlerts();

    if (jobsNeedingAlerts.length === 0) {
      logger.info("No jobs need alerts — all caught up!");
    } else {
      logger.info(`Found ${jobsNeedingAlerts.length} jobs needing alerts`);

      for (const job of jobsNeedingAlerts) {
        const rawContent = getRawJobContent(job.id);
        let fitAnalysis = null;

        if (rawContent) {
          const canonicalJob = buildCanonicalJob({
            id: job.id,
            title: job.title,
            company: job.company,
            source: job.source,
            url: job.url,
            city: job.city,
            work_mode: job.work_mode,
            score: job.score,
            score_band: job.score_band,
            posted_at: job.posted_at,
            first_seen_at: job.first_seen_at,
            title_bucket: "include",
          });

          fitAnalysis = await analyzeFit(canonicalJob, rawContent, config);

          if (fitAnalysis) {
            insertFitAnalysis(job.id, fitAnalysis);
          }
        }

        await sendJobAlert(
          {
            id: job.id,
            title: job.title,
            company: job.company,
            city: job.city ?? null,
            workMode: job.work_mode as WorkMode,
            score: job.score,
            scoreBand: job.score_band,
            url: job.url,
            source: job.source,
            postedAt: job.posted_at ?? null,
            firstSeenAt: job.first_seen_at,
          },
          fitAnalysis,
        );

        totalAlerts++;
      }

      logger.info(`Alerts complete: ${totalAlerts}/${jobsNeedingAlerts.length} alerts sent`);
    }
  }

  logger.info("═══════════════════════════════════════════════════");
  logger.info("  Resume Complete");
  logger.info("═══════════════════════════════════════════════════");
  logger.info(`  Jobs analyzed: ${totalAnalyzed}`);
  logger.info(`  Alerts sent: ${totalAlerts}`);

  process.exit(0);
}

main().catch(error => {
  logger.error(`Resume failed: ${error}`);
  process.exit(1);
});
