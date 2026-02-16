import cron from "node-cron";
import { logger } from "../logger";
import { runPipeline } from "../pipeline";
import {
  sendDigest,
  sendMessage,
  sendSystemAlert,
  initAlerts,
} from "../alerts";
import { formatDigest } from "../alerts/digest";
import { formatWeeklyReport } from "../reports/weekly";
import { getLastSuccessfulRunTime, archiveOldJobs } from "../db/operations";
import type { AppConfig } from "../config";

let _config: AppConfig | null = null;
let _pipelineRunning = false;

/** Guard wrapper: skip if a pipeline run is already in progress */
async function runPipelineGuarded(
  config: AppConfig,
  opts: { runType?: string; isBackfill?: boolean } = {},
): Promise<ReturnType<typeof runPipeline> | null> {
  if (_pipelineRunning) {
    logger.warn(
      `[LOCK] Pipeline already running — skipping ${opts.runType ?? "scheduled"} run`,
    );
    return null;
  }
  _pipelineRunning = true;
  try {
    return await runPipeline(config, opts);
  } finally {
    _pipelineRunning = false;
  }
}

export function startScheduler(config: AppConfig): void {
  _config = config;

  // Initialize alerts
  initAlerts({
    telegramBotToken: config.env.telegramBotToken,
    telegramChatId: config.env.telegramChatId,
    telegramLogBotToken: config.env.telegramLogBotToken,
    telegramLogChatId: config.env.telegramLogChatId,
    dryRun: config.env.dryRun,
  });

  logger.info("Starting scheduler...");

  // ATS Sweep: Every 3 hours
  cron.schedule(
    "0 */3 * * *",
    async () => {
      logger.info("[CRON] Starting 3-hourly ATS sweep...");
      try {
        const result = await runPipelineGuarded(config, {
          runType: "scheduled",
        });
        if (!result) return;
        logger.info(
          `[CRON] ATS sweep complete: ${result.jobsNew} new, ${result.jobsDuplicate} dupe, ${result.errors.length} errors`,
        );
      } catch (error) {
        logger.error(`[CRON] ATS sweep failed: ${error}`);
        await sendSystemAlert(`🚨 Scheduled ATS sweep failed: ${error}`);
      }
    },
    {
      timezone: config.env.timezone || "America/Toronto",
    },
  );
  logger.info("  ✓ ATS sweep: every 3 hours");

  // Morning Digest: 8:30 AM ET
  cron.schedule(
    "30 8 * * *",
    async () => {
      logger.info("[CRON] Sending morning digest...");
      try {
        const digestPayload = formatDigest("morning");
        await sendDigest(
          digestPayload.header,
          "morning_digest",
          digestPayload.bands,
        );
        logger.info("[CRON] Morning digest sent.");
      } catch (error) {
        logger.error(`[CRON] Morning digest failed: ${error}`);
        await sendSystemAlert(`🚨 Morning digest failed: ${error}`);
      }
    },
    {
      timezone: config.env.timezone || "America/Toronto",
    },
  );
  logger.info("  ✓ Morning digest: 8:30 AM ET");

  // Evening Digest: 6:00 PM ET
  cron.schedule(
    "0 18 * * *",
    async () => {
      logger.info("[CRON] Sending evening digest...");
      try {
        const digestPayload = formatDigest("evening");
        await sendDigest(
          digestPayload.header,
          "evening_digest",
          digestPayload.bands,
        );
        logger.info("[CRON] Evening digest sent.");
      } catch (error) {
        logger.error(`[CRON] Evening digest failed: ${error}`);
        await sendSystemAlert(`🚨 Evening digest failed: ${error}`);
      }
    },
    {
      timezone: config.env.timezone || "America/Toronto",
    },
  );
  logger.info("  ✓ Evening digest: 6:00 PM ET");

  // Weekly Report: Sunday 7:00 PM ET
  cron.schedule(
    "0 19 * * 0",
    async () => {
      logger.info("[CRON] Generating weekly report...");
      try {
        // Weekly report logic — will be expanded with analytics
        const report = formatWeeklyReport();
        await sendMessage("job", report);
        logger.info("[CRON] Weekly report sent.");
      } catch (error) {
        logger.error(`[CRON] Weekly report failed: ${error}`);
        await sendSystemAlert(`🚨 Weekly report failed: ${error}`);
      }
    },
    {
      timezone: config.env.timezone || "America/Toronto",
    },
  );
  logger.info("  ✓ Weekly report: Sunday 7:00 PM ET");

  // Archive old jobs: Sunday 3:00 AM ET
  cron.schedule(
    "0 3 * * 0",
    async () => {
      logger.info("[CRON] Running archive cleanup...");
      try {
        archiveOldJobs();
        logger.info("[CRON] Archive cleanup complete.");
      } catch (error) {
        logger.error(`[CRON] Archive cleanup failed: ${error}`);
      }
    },
    {
      timezone: config.env.timezone || "America/Toronto",
    },
  );
  logger.info("  ✓ Archive cleanup: Sunday 3:00 AM ET");

  logger.info("Scheduler started with 5 jobs.");

  // Catch-up: if last run was > 4 hours ago, trigger immediate ingest
  checkAndRunCatchUp(config);
}

async function checkAndRunCatchUp(config: AppConfig): Promise<void> {
  try {
    const lastRun = getLastSuccessfulRunTime();
    if (!lastRun) {
      logger.info(
        "[CATCH-UP] No previous runs found — triggering initial ingest...",
      );
      await runPipelineGuarded(config, { runType: "catch-up" });
      return;
    }

    const hoursSinceLastRun =
      (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRun > 4) {
      logger.info(
        `[CATCH-UP] Last run was ${hoursSinceLastRun.toFixed(1)}h ago — triggering catch-up ingest...`,
      );
      await runPipelineGuarded(config, { runType: "catch-up" });
    } else {
      logger.info(
        `[CATCH-UP] Last run was ${hoursSinceLastRun.toFixed(1)}h ago — no catch-up needed`,
      );
    }
  } catch (error) {
    logger.error(`[CATCH-UP] Failed: ${error}`);
    await sendSystemAlert(`🚨 Catch-up ingest failed: ${error}`);
  }
}
