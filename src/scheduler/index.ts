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
import { runBoardDiscovery } from "../connectors/cse-discovery";
import type { AppConfig } from "../config";

let _config: AppConfig | null = null;
let _pipelineRunning = false;

import type { RunConnectorOptions } from "../connectors";

async function runPipelineGuarded(
  config: AppConfig,
  opts: {
    runType?: string;
    isBackfill?: boolean;
    connectorOptions?: RunConnectorOptions;
  } = {},
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

  initAlerts({
    telegramBotToken: config.env.telegramBotToken,
    telegramChatId: config.env.telegramChatId,
    telegramLogBotToken: config.env.telegramLogBotToken,
    telegramLogChatId: config.env.telegramLogChatId,
    dryRun: config.env.dryRun,
  });

  const CRON_ATS_SWEEP = "0 */3 * * *";
  const CRON_AGGREGATORS =
    config.sources.sources["serpapi-aggregators"]?.schedule ?? "0 8,20 * * *";
  const CRON_UNDERGROUND =
    config.sources.sources["serpapi-underground"]?.schedule ?? "0 8,20 * * *";
  const CRON_PRE_MORNING_INGEST = "5 8 * * *";
  const CRON_MORNING_DIGEST = "30 8 * * *";
  const CRON_PRE_EVENING_INGEST = "30 17 * * *";
  const CRON_EVENING_DIGEST = "0 18 * * *";
  const CRON_WEEKLY_REPORT = "0 19 * * 0";
  const CRON_ARCHIVE_CLEANUP = "0 3 * * 0";

  logger.info("Starting scheduler...");

  cron.schedule(
    CRON_ATS_SWEEP,
    async () => {
      logger.info("[CRON] Starting 3-hourly ATS sweep...");
      try {
        const result = await runPipelineGuarded(config, {
          runType: "scheduled-ats",
          connectorOptions: {
            includeAts: true,
            includeAggregators: false,
            includeUnderground: false,
          },
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
    { timezone: config.env.timezone || "America/Toronto" },
  );
  logger.info("  ✓ ATS sweep: every 3 hours");

  if (config.sources.sources["serpapi-aggregators"]?.enabled) {
    cron.schedule(
      CRON_AGGREGATORS,
      async () => {
        logger.info("[CRON] Starting Aggregator sweep...");
        try {
          const result = await runPipelineGuarded(config, {
            runType: "scheduled-aggregators",
            connectorOptions: {
              includeAts: false,
              includeAggregators: true,
              includeUnderground: false,
            },
          });
          if (!result) return;
          logger.info(
            `[CRON] Aggregators complete: ${result.jobsNew} new, ${result.jobsDuplicate} dupe`,
          );
        } catch (error) {
          logger.error(`[CRON] Aggregators failed: ${error}`);
          await sendSystemAlert(`🚨 Aggregators failed: ${error}`);
        }
      },
      { timezone: config.env.timezone || "America/Toronto" },
    );
    logger.info(
      `  ✓ Aggregators: ${config.sources.sources["serpapi-aggregators"].scheduleDescription}`,
    );
  }

  if (config.sources.sources["serpapi-underground"]?.enabled) {
    cron.schedule(
      CRON_UNDERGROUND,
      async () => {
        logger.info("[CRON] Starting Underground sweep...");
        try {
          const result = await runPipelineGuarded(config, {
            runType: "scheduled-underground",
            connectorOptions: {
              includeAts: false,
              includeAggregators: false,
              includeUnderground: true,
            },
          });
          if (!result) return;
          logger.info(
            `[CRON] Underground complete: ${result.jobsNew} new, ${result.jobsDuplicate} dupe`,
          );
        } catch (error) {
          logger.error(`[CRON] Underground failed: ${error}`);
          await sendSystemAlert(`🚨 Underground failed: ${error}`);
        }
      },
      { timezone: config.env.timezone || "America/Toronto" },
    );
    logger.info(
      `  ✓ Underground: ${config.sources.sources["serpapi-underground"].scheduleDescription}`,
    );
  }

  // Pre-morning: Discovery + Ingest (runs before morning digest)
  cron.schedule(
    CRON_PRE_MORNING_INGEST,
    async () => {
      logger.info("[CRON] Pre-morning: running discovery + ingest...");
      try {
        // Step 1: Board Discovery
        if (config.sources.sources["serpapi-discovery"]?.enabled) {
          logger.info("[CRON] Running board discovery...");
          const discoveryResult = await runBoardDiscovery(config.env);
          logger.info(
            `[CRON] Board discovery complete: ${discoveryResult.totalInserted} new boards found`,
          );
          if (discoveryResult.totalInserted > 0) {
            await sendSystemAlert(
              `📋 Board discovery: ${discoveryResult.totalInserted} new boards (GH: ${discoveryResult.byPlatform.greenhouse}, Lever: ${discoveryResult.byPlatform.lever}, Ashby: ${discoveryResult.byPlatform.ashby})`,
            );
          }
        }

        // Step 2: ATS Ingest (includes newly discovered boards)
        logger.info("[CRON] Running pre-digest ATS ingest...");
        const result = await runPipelineGuarded(config, {
          runType: "pre-morning-ingest",
          connectorOptions: {
            includeAts: true,
            includeAggregators: false,
            includeUnderground: false,
          },
        });
        if (result) {
          logger.info(
            `[CRON] Pre-morning ingest complete: ${result.jobsNew} new jobs`,
          );
        }
      } catch (error) {
        logger.error(`[CRON] Pre-morning ingest failed: ${error}`);
        await sendSystemAlert(`🚨 Pre-morning ingest failed: ${error}`);
      }
    },
    { timezone: config.env.timezone || "America/Toronto" },
  );
  logger.info("  ✓ Pre-morning ingest: 8:05 AM ET (discovery + ATS)");

  // Morning Digest
  cron.schedule(
    CRON_MORNING_DIGEST,
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

  // Pre-evening: Ingest (runs before evening digest)
  cron.schedule(
    CRON_PRE_EVENING_INGEST,
    async () => {
      logger.info("[CRON] Pre-evening: running ingest...");
      try {
        const result = await runPipelineGuarded(config, {
          runType: "pre-evening-ingest",
          connectorOptions: {
            includeAts: true,
            includeAggregators: false,
            includeUnderground: false,
          },
        });
        if (result) {
          logger.info(
            `[CRON] Pre-evening ingest complete: ${result.jobsNew} new jobs`,
          );
        }
      } catch (error) {
        logger.error(`[CRON] Pre-evening ingest failed: ${error}`);
        await sendSystemAlert(`🚨 Pre-evening ingest failed: ${error}`);
      }
    },
    { timezone: config.env.timezone || "America/Toronto" },
  );
  logger.info("  ✓ Pre-evening ingest: 5:30 PM ET");

  // Evening Digest
  cron.schedule(
    CRON_EVENING_DIGEST,
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

  // Weekly Report
  cron.schedule(
    CRON_WEEKLY_REPORT,
    async () => {
      logger.info("[CRON] Generating weekly report...");
      try {
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

  // Archive old jobs
  cron.schedule(
    CRON_ARCHIVE_CLEANUP,
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

  logger.info("Scheduler started with 9 jobs.");

  checkAndRunCatchUp(config).catch((e) => {
    logger.error(`[SCHEDULER] Startup catch-up failed: ${e}`);
  });
}

async function checkAndRunCatchUp(config: AppConfig): Promise<void> {
  try {
    const lastRun = getLastSuccessfulRunTime();
    if (!lastRun) {
      logger.info(
        "[CATCH-UP] No previous runs found — triggering initial ingest...",
      );
      await runPipelineGuarded(config, {
        runType: "catch-up",
        connectorOptions: {
          includeAts: true,
          includeAggregators: false,
          includeUnderground: false,
        },
      });
      return;
    }

    const hoursSinceLastRun =
      (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastRun > 4) {
      logger.info(
        `[CATCH-UP] Last run was ${hoursSinceLastRun.toFixed(1)}h ago — triggering catch-up ingest...`,
      );
      await runPipelineGuarded(config, {
        runType: "catch-up",
        connectorOptions: {
          includeAts: true,
          includeAggregators: false,
          includeUnderground: false,
        },
      });
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
