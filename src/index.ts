import { Hono } from "hono";
import { logger } from "./logger";
import {
  initializeDatabase,
  checkDatabaseIntegrity,
  getDatabaseStats,
  quickHealthCheck,
} from "./db";
import { loadConfig, type AppConfig } from "./config";
import { startScheduler } from "./scheduler";
import { handleCallbackQuery, startCallbackPolling } from "./alerts/callback";
import {
  getJobsByScore,
  getJobById,
  markJobApplied,
  markJobDismissed,
  getSourceAnalytics,
  getWeeklySummary,
  getFitAnalysis,
  getAlternateUrls,
} from "./db/operations";
import type { TitleBucket, JobStatus } from "./types";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Job Search Automation Engine");
logger.info("═══════════════════════════════════════════════════");

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  logger.error("Failed to load configuration:", error);
  process.exit(1);
}

try {
  initializeDatabase();
  const { importBoards } = await import("./scripts/sync-boards");
  importBoards();
} catch (error) {
  logger.error("Failed to initialize database:", error);
  process.exit(1);
}

const integrity = checkDatabaseIntegrity();
if (!integrity.ok) {
  logger.error(`Database integrity check failed: ${integrity.result}`);
  logger.error(
    "Please restore from backup or delete data/jobsearch.db to recreate.",
  );
  process.exit(1);
}

const app = new Hono();

app.get("/health", (c) => {
  const dbOk = quickHealthCheck();
  const stats = getDatabaseStats();

  return c.json({
    status: dbOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    dryRun: config.env.dryRun,
    database: {
      ok: dbOk,
      stats,
    },
  });
});

app.get("/status", (c) => {
  const stats = getDatabaseStats();

  return c.json({
    timestamp: new Date().toISOString(),
    dryRun: config.env.dryRun,
    environment: config.env.nodeEnv,
    enabledSources: Object.entries(config.sources.sources)
      .filter(([, s]) => s.enabled)
      .map(([name]) => name),
    seedCompanies: {
      greenhouse: config.companies.greenhouse.length,
      lever: config.companies.lever.length,
      ashby: config.companies.ashby.length,
      workable: config.companies.workable?.length ?? 0,
      smartrecruiters: config.companies.smartrecruiters?.length ?? 0,
      bamboohr: config.companies.bamboohr?.length ?? 0,
    },
    serpApiKeys: config.env.serpApiKeys.length,
    database: stats,
  });
});

app.get("/api/jobs", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const band = c.req.query("band") as string | undefined;
  const bucket = c.req.query("bucket") as TitleBucket | undefined;
  const status = (c.req.query("status") as JobStatus) ?? "active";
  const since = c.req.query("since") as string | undefined;
  const minScore = Number.parseInt(c.req.query("minScore") ?? "", 10);
  const tiersRaw = c.req.query("tiers") ?? c.req.query("tier") ?? "";

  const tiers = tiersRaw
    .split(",")
    .map((tier) => tier.trim())
    .filter((tier) => tier.length > 0);

  const bandRanges: Record<string, { min: number; max: number }> = {
    topPriority: { min: 80, max: 100 },
    goodMatch: { min: 65, max: 79 },
    worthALook: { min: 50, max: 64 },
  };
  const selectedBand = band ? bandRanges[band] : undefined;

  const jobs = getJobsByScore({
    titleBucket: bucket,
    status,
    limit: Math.min(limit, 200),
    offset,
    sinceDate: since,
    minScore: Number.isFinite(minScore) ? minScore : selectedBand?.min,
    maxScore: selectedBand?.max,
    tiers: tiers.length > 0 ? tiers : undefined,
  });

  return c.json({
    count: jobs.length,
    offset,
    limit,
    jobs,
  });
});

app.get("/api/jobs/:id", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const job = getJobById(id);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({
    ...job,
    fitAnalysis: getFitAnalysis(id),
    alternateUrls: getAlternateUrls(id),
  });
});

app.post("/api/jobs/:id/applied", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const job = getJobById(id);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  markJobApplied(id);
  return c.json({ success: true, action: "applied", jobId: id });
});

app.post("/api/jobs/:id/dismissed", (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const job = getJobById(id);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  markJobDismissed(id);
  return c.json({ success: true, action: "dismissed", jobId: id });
});

app.post("/api/telegram/callback", async (c) => {
  try {
    const update = await c.req.json();
    const result = await handleCallbackQuery(
      update,
      config.env.telegramBotToken,
    );
    return c.json(result);
  } catch (error) {
    logger.error(`Telegram callback error: ${error}`);
    return c.json({ success: false, error: "Internal error" }, 500);
  }
});

app.get("/api/analytics/sources", (c) => {
  const days = parseInt(c.req.query("days") ?? "7", 10);
  const analytics = getSourceAnalytics(days);
  return c.json({
    period: `${days} days`,
    sources: analytics,
  });
});

app.get("/api/analytics/weekly", (c) => {
  const summary = getWeeklySummary();
  return c.json(summary);
});

const port = config.env.port;

logger.info(`Starting server on port ${port}...`);

if (config.env.dryRun) {
  logger.info("🧪 DRY RUN MODE — no Telegram alerts will be sent");
}

startScheduler(config);

// Fallback path for local/dev deployments where no public webhook is configured.
startCallbackPolling(config.env.telegramBotToken, {
  force: process.env.TELEGRAM_FORCE_POLLING === "true",
});

export default {
  port,
  fetch: app.fetch,
};

logger.info(`✅ Job Search Engine started on http://localhost:${port}`);
logger.info(`   Health: http://localhost:${port}/health`);
logger.info(`   Status: http://localhost:${port}/status`);
logger.info(`   API:    http://localhost:${port}/api/jobs`);
logger.info("═══════════════════════════════════════════════════");
