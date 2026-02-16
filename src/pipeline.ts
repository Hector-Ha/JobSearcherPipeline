import { logger } from "./logger";
import { runAllConnectors } from "./connectors";
import { normalizeJob } from "./normalizer";
import { scoreJob } from "./scoring";
import { checkDuplicate, loadFuzzyCache, clearFuzzyCache } from "./dedup";
import { sendJobAlert, sendSystemAlert, initAlerts } from "./alerts";
import { analyzeFit, getModalKeyCount, initKeyPool } from "./ai";
import type { FitAnalysis } from "./ai";
import {
  createRun,
  finishRun,
  insertRawJob,
  insertCanonicalJob,
  updateSourceMetrics,
  updateConnectorCheckpoint,
  insertDuplicateLink,
  insertFitAnalysis,
  getConnectorCheckpoint,
  insertAlternateUrl,
} from "./db/operations";
import type { AppConfig } from "./config";
import type { PipelineRunResult, RawJob, CanonicalJob } from "./types";

interface JobForAnalysis {
  canonicalId: number;
  canonical: CanonicalJob;
  rawContent: string;
  score: { total: number; band: string };
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  const queue = [...items];

  for (const item of queue) {
    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }

    const promise = processor(item)
      .then(result => {
        results.push(result);
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

export async function runPipeline(
  config: AppConfig,
  options: { isBackfill?: boolean; runType?: string } = {},
): Promise<PipelineRunResult> {
  const startTime = Date.now();
  const runType = options.runType ?? "scheduled";
  const isBackfill = options.isBackfill ?? false;

  logger.info("═══════════════════════════════════════════════════");
  logger.info(`  Pipeline Run: ${runType}${isBackfill ? " (backfill)" : ""}`);
  logger.info("═══════════════════════════════════════════════════");

  initAlerts({
    telegramBotToken: config.env.telegramBotToken,
    telegramChatId: config.env.telegramChatId,
    telegramLogBotToken: config.env.telegramLogBotToken,
    telegramLogChatId: config.env.telegramLogChatId,
    dryRun: config.env.dryRun,
  });

  const runId = createRun(runType, config.env.dryRun);
  logger.info(`Run ID: ${runId}`);

  const errors: string[] = [];
  let jobsFound = 0;
  let jobsNew = 0;
  let jobsDuplicate = 0;
  let jobsRejected = 0;
  let jobsMaybe = 0;
  let instantAlertsSent = 0;
  let jobsAnalyzed = 0;
  let sourcesAttempted = 0;
  let sourcesSucceeded = 0;

  try {
    logger.info("Step 1/5: Running connectors...");
    const connectorResults = await runAllConnectors(config);

    const sourceStats: Record<
      string,
      {
        jobsFound: number;
        jobsNew: number;
        jobsDuplicate: number;
        parseFailures: number;
        rateLimitHits: number;
        responseTimes: number[];
      }
    > = {};

    for (const result of connectorResults) {
      sourcesAttempted++;

      if (!sourceStats[result.source]) {
        sourceStats[result.source] = {
          jobsFound: 0,
          jobsNew: 0,
          jobsDuplicate: 0,
          parseFailures: 0,
          rateLimitHits: 0,
          responseTimes: [],
        };
      }

      if (result.success) {
        sourcesSucceeded++;
        sourceStats[result.source].jobsFound += result.jobs.length;
        sourceStats[result.source].responseTimes.push(result.responseTimeMs);
      } else {
        errors.push(`${result.source}/${result.company}: ${result.error}`);
        if (result.rateLimited) {
          sourceStats[result.source].rateLimitHits++;
        }
      }

      updateConnectorCheckpoint(
        `${result.source}/${result.company}`,
        result.success,
        result.jobs.length,
      );

      if (!result.success) {
        const checkpoint = getConnectorCheckpoint(
          `${result.source}/${result.company}`,
        );
        if (
          checkpoint &&
          checkpoint.error_count_consecutive >= 3 &&
          checkpoint.error_count_consecutive % 3 === 0
        ) {
          const alertMsg = `🚨 SYSTEM ALERT — ${result.source}/${result.company}\nReturned 0 jobs for ${checkpoint.error_count_consecutive} consecutive cycles.\nCheck logs or run: bun run health-check`;
          await sendSystemAlert(alertMsg);
        }
      }
    }

    const allRawJobs: RawJob[] = connectorResults.flatMap((r) => r.jobs);
    jobsFound = allRawJobs.length;
    logger.info(`Step 2/5: Processing ${jobsFound} raw jobs...`);

    loadFuzzyCache();

    // Initialize AI key pool early
    initKeyPool(config);
    const concurrency = Math.max(1, getModalKeyCount());
    const jobsForAnalysis: JobForAnalysis[] = [];
    const alertsToSend: Array<{
      canonicalId: number;
      canonical: CanonicalJob;
      score: { total: number; band: string };
    }> = [];

    for (const rawJob of allRawJobs) {
      try {
        const rawJobId = insertRawJob(rawJob, runId);

        const canonical = normalizeJob(rawJob, config);
        canonical.isBackfill = isBackfill;

        if (canonical.titleBucket === "reject") {
          jobsRejected++;
          continue;
        }

        if (canonical.titleBucket === "maybe") {
          jobsMaybe++;
        }

        const dedupResult = checkDuplicate(canonical);

        if (dedupResult.isDuplicate && dedupResult.existingJobId) {
          if (canonical.source !== "greenhouse") {
            insertAlternateUrl(
              dedupResult.existingJobId,
              canonical.url,
              canonical.source,
            );
          }

          if (!dedupResult.isPotentialDuplicate) {
            jobsDuplicate++;
            sourceStats[rawJob.source].jobsDuplicate++;
            continue;
          }
        }

        if (dedupResult.isRepost) {
          canonical.isReposted = true;
          canonical.originalPostDate = dedupResult.originalPostDate ?? null;
        }

        const score = scoreJob(canonical, config);
        canonical.score = score.total;
        canonical.scoreFreshness = score.freshness;
        canonical.scoreLocation = score.location;
        canonical.scoreMode = score.mode;
        canonical.scoreBand = score.band;

        const canonicalId = insertCanonicalJob(canonical, rawJobId);
        jobsNew++;
        sourceStats[rawJob.source].jobsNew++;

        if (dedupResult.isPotentialDuplicate && dedupResult.existingJobId) {
          insertDuplicateLink(
            canonicalId,
            dedupResult.existingJobId,
            dedupResult.matchMethod!,
            0.75,
            true,
          );
        }

        // Collect jobs for AI analysis
        if (score.total >= config.env.aiAnalysisMinScore && !isBackfill) {
          jobsForAnalysis.push({
            canonicalId,
            canonical,
            rawContent: rawJob.content,
            score: { total: score.total, band: score.band },
          });
        }

        // Collect alerts to send (after AI analysis)
        if (
          score.band === "topPriority" &&
          canonical.titleBucket === "include" &&
          !isBackfill
        ) {
          alertsToSend.push({
            canonicalId,
            canonical,
            score: { total: score.total, band: score.band },
          });
        }
      } catch (error) {
        const errMsg = `Failed to process job from ${rawJob.source}: ${error}`;
        logger.error(errMsg);
        errors.push(errMsg);
        sourceStats[rawJob.source].parseFailures++;
      }
    }

    clearFuzzyCache();

    // Run AI analysis in parallel
    if (jobsForAnalysis.length > 0) {
      logger.info(
        `Step 2.5/5: Running AI analysis on ${jobsForAnalysis.length} jobs (concurrency: ${concurrency})...`,
      );

      const analysisResults = await runWithConcurrency(
        jobsForAnalysis,
        concurrency,
        async (job) => {
          const fitAnalysis = await analyzeFit(
            job.canonical,
            job.rawContent,
            config,
          );
          return { ...job, fitAnalysis };
        },
      );

      // Store analysis results and count
      const analysisMap = new Map<number, FitAnalysis | null>();
      for (const result of analysisResults) {
        if (result.fitAnalysis) {
          insertFitAnalysis(result.canonicalId, result.fitAnalysis);
          jobsAnalyzed++;
          analysisMap.set(result.canonicalId, result.fitAnalysis);
        }
      }

      // Send alerts with fit analysis
      for (const alert of alertsToSend) {
        const fitAnalysis = analysisMap.get(alert.canonicalId) ?? null;
        await sendJobAlert(
          {
            id: alert.canonicalId,
            title: alert.canonical.title,
            company: alert.canonical.company,
            city: alert.canonical.city,
            workMode: alert.canonical.workMode,
            score: alert.score.total,
            scoreBand: alert.score.band,
            url: alert.canonical.url,
            source: alert.canonical.source,
            postedAt: alert.canonical.postedAt,
            firstSeenAt: alert.canonical.firstSeenAt,
          },
          fitAnalysis,
        );
        instantAlertsSent++;
      }
    } else {
      // Send alerts without AI analysis
      for (const alert of alertsToSend) {
        await sendJobAlert(
          {
            id: alert.canonicalId,
            title: alert.canonical.title,
            company: alert.canonical.company,
            city: alert.canonical.city,
            workMode: alert.canonical.workMode,
            score: alert.score.total,
            scoreBand: alert.score.band,
            url: alert.canonical.url,
            source: alert.canonical.source,
            postedAt: alert.canonical.postedAt,
            firstSeenAt: alert.canonical.firstSeenAt,
          },
          null,
        );
        instantAlertsSent++;
      }
    }

    logger.info("Step 3/5: Updating source metrics...");
    for (const [source, stats] of Object.entries(sourceStats)) {
      const avgResponseTime =
        stats.responseTimes.length > 0
          ? Math.round(
              stats.responseTimes.reduce((a, b) => a + b, 0) /
                stats.responseTimes.length,
            )
          : 0;

      updateSourceMetrics(source, {
        jobsFound: stats.jobsFound,
        jobsNew: stats.jobsNew,
        jobsDuplicate: stats.jobsDuplicate,
        parseFailures: stats.parseFailures,
        rateLimitHits: stats.rateLimitHits,
        responseTimeAvgMs: avgResponseTime,
      });
    }

    logger.info("Step 4/5: Finalizing run...");
    finishRun(runId, "completed", {
      sourcesAttempted,
      sourcesSucceeded,
      jobsFound,
      jobsNew,
      jobsDuplicate,
      errors,
    });

    const durationMs = Date.now() - startTime;

    logger.info("Step 5/5: Summary");
    logger.info(`  Jobs found: ${jobsFound}`);
    logger.info(`  Jobs new: ${jobsNew}`);
    logger.info(`  Jobs duplicate: ${jobsDuplicate}`);
    logger.info(`  Jobs rejected (title filter): ${jobsRejected}`);
    logger.info(`  Jobs maybe (manual review): ${jobsMaybe}`);
    logger.info(`  Jobs AI analyzed: ${jobsAnalyzed}`);
    logger.info(`  Instant alerts sent: ${instantAlertsSent}`);
    logger.info(`  Sources: ${sourcesSucceeded}/${sourcesAttempted} succeeded`);
    logger.info(`  Errors: ${errors.length}`);
    logger.info(`  Duration: ${(durationMs / 1000).toFixed(1)}s`);
    logger.info("═══════════════════════════════════════════════════");

    return {
      runId,
      sourcesAttempted,
      sourcesSucceeded,
      jobsFound,
      jobsNew,
      jobsDuplicate,
      jobsRejected,
      jobsMaybe,
      jobsAnalyzed,
      errors,
      durationMs,
      instantAlertsSent,
    };
  } catch (error) {
    const errMsg = `Pipeline run failed: ${error}`;
    logger.error(errMsg);
    errors.push(errMsg);

    finishRun(runId, "failed", {
      sourcesAttempted,
      sourcesSucceeded,
      jobsFound,
      jobsNew,
      jobsDuplicate,
      errors,
    });

    await sendSystemAlert(`🚨 PIPELINE FAILURE\n${errMsg}`);

    return {
      runId,
      sourcesAttempted,
      sourcesSucceeded,
      jobsFound,
      jobsNew,
      jobsDuplicate,
      jobsRejected,
      jobsMaybe,
      jobsAnalyzed,
      errors,
      durationMs: Date.now() - startTime,
      instantAlertsSent,
    };
  }
}
