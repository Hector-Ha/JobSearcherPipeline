import { logger } from "../logger";
import {
  initializeDatabase,
  checkDatabaseIntegrity,
  getDatabaseStats,
} from "../db";
import { loadConfig } from "../config";
import { getRetryQueueSize, getConnectorCheckpoint } from "../db/operations";

logger.info("═══════════════════════════════════════════════════");
logger.info("  Health Check");
logger.info("═══════════════════════════════════════════════════");

const config = loadConfig();
initializeDatabase();

// Database integrity
const integrity = checkDatabaseIntegrity();
logger.info(
  `Database integrity: ${integrity.ok ? "✅ OK" : "❌ FAILED"} (${integrity.result})`,
);

// Database stats
const stats = getDatabaseStats();
logger.info("Database stats:");
for (const [table, count] of Object.entries(stats)) {
  logger.info(`  ${table}: ${count} rows`);
}

// Retry queue
const retryQueueSize = getRetryQueueSize();
logger.info(`\nRetry queue: ${retryQueueSize} pending`);

// Connector endpoint health
logger.info("\nConnector endpoint checks:");

const testEndpoints: Array<{ name: string; urls: string[] }> = [];

// Build test URLs from enabled sources
if (config.sources.sources.greenhouse?.enabled) {
  testEndpoints.push({
    name: "Greenhouse API",
    urls: [
      "https://boards-api.greenhouse.io/v1/boards/greenhouse/jobs",
      "https://developers.greenhouse.io/job-board.html",
    ],
  });
}

if (config.sources.sources.lever?.enabled) {
  testEndpoints.push({
    name: "Lever API",
    urls: [
      "https://api.lever.co/v0/postings/lever?mode=json",
      "https://github.com/lever/postings-api",
    ],
  });
}

if (config.sources.sources.ashby?.enabled) {
  testEndpoints.push({
    name: "Ashby API",
    urls: [
      "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams",
      "https://developers.ashbyhq.com/",
    ],
  });
}

for (const endpoint of testEndpoints) {
  let reachable = false;
  let lastStatus = 0;
  let lastError = "";

  for (const testUrl of endpoint.urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(testUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json,text/html" },
      });

      clearTimeout(timeout);
      lastStatus = response.status;

      if (response.status >= 200 && response.status < 500) {
        reachable = true;
        break;
      }
    } catch (error) {
      lastError = String(error);
    }
  }

  if (reachable) {
    logger.info(`  ✅ ${endpoint.name} — reachable (HTTP ${lastStatus})`);
  } else if (lastError.includes("AbortError")) {
    logger.warn(`  ⚠️ ${endpoint.name} — timed out from this network`);
  } else {
    logger.error(
      `  ❌ ${endpoint.name} — unreachable: ${lastError || lastStatus}`,
    );
  }
}

// Connector checkpoint summary
logger.info("\nConnector checkpoints:");
const sources = ["greenhouse", "lever", "ashby"];
for (const source of sources) {
  const companies = config.companies[source as keyof typeof config.companies];
  if (Array.isArray(companies)) {
    for (const company of companies.slice(0, 5)) {
      const checkpoint = getConnectorCheckpoint(`${source}/${company}`);
      if (checkpoint) {
        const lastSuccess = checkpoint.last_success_at ?? "never";
        const errors = checkpoint.error_count_consecutive;
        const status = errors >= 3 ? "🔴" : errors > 0 ? "🟡" : "🟢";
        logger.info(
          `  ${status} ${source}/${company} — last success: ${lastSuccess}, consecutive errors: ${errors}`,
        );
      }
    }
  }
}

logger.info("═══════════════════════════════════════════════════");
process.exit(integrity.ok ? 0 : 1);
