import { Hono } from "hono";
import { logger } from "./logger";
import {
  initializeDatabase,
  checkDatabaseIntegrity,
  getDatabaseStats,
} from "./db";
import { loadConfig, type AppConfig } from "./config";

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
  const dbIntegrity = checkDatabaseIntegrity();
  const stats = getDatabaseStats();

  return c.json({
    status: dbIntegrity.ok ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    dryRun: config.env.dryRun,
    database: {
      integrity: dbIntegrity.result,
      stats,
    },
  });
});

// Status endpoint
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
    },
    cseApiKeys: config.env.googleCseApiKeys.length,
    database: stats,
  });
});

// REST API endpoints (FinalStrategy.md lines 747-753)
app.get("/api/jobs", (c) => {
  // TODO: Browse jobs with filters
  return c.json({ message: "Not implemented yet — Phase 1 Day 3", jobs: [] });
});

app.get("/api/jobs/:id", (c) => {
  // TODO: Job detail
  return c.json({ message: "Not implemented yet — Phase 1 Day 3" });
});

app.post("/api/jobs/:id/applied", (c) => {
  // TODO: Mark as applied
  return c.json({ message: "Not implemented yet — Phase 1 Day 3" });
});

app.post("/api/jobs/:id/dismissed", (c) => {
  // TODO: Mark as dismissed
  return c.json({ message: "Not implemented yet — Phase 1 Day 3" });
});

app.get("/api/analytics/sources", (c) => {
  // TODO: Source analytics
  return c.json({ message: "Not implemented yet — Phase 3" });
});

app.get("/api/analytics/weekly", (c) => {
  // TODO: Weekly summary
  return c.json({ message: "Not implemented yet — Phase 3" });
});

const port = config.env.port;

logger.info(`Starting server on port ${port}...`);

if (config.env.dryRun) {
  logger.info("🧪 DRY RUN MODE — no Telegram alerts will be sent");
}

export default {
  port,
  fetch: app.fetch,
};

logger.info(`✅ Job Search Engine started on http://localhost:${port}`);
logger.info(`   Health: http://localhost:${port}/health`);
logger.info(`   Status: http://localhost:${port}/status`);
logger.info("═══════════════════════════════════════════════════");
