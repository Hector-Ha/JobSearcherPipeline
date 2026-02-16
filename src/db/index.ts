import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { SCHEMA_VERSION } from "./schema";
import { runMigrations } from "./migrations";
import { logger } from "../logger";

const DATA_DIR = join(import.meta.dir, "../../data");
const DB_PATH = join(DATA_DIR, "jobsearch.db");

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  logger.info(`Created data directory: ${DATA_DIR}`);
}

// Initialize SQLite database with WAL mode for better concurrent access
const db = new Database(DB_PATH, { create: true });

// Enable WAL mode for better write performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
db.run("PRAGMA busy_timeout = 5000");

export function initializeDatabase(): void {
  logger.info("Initializing database...");

  try {
    // Apply versioned migrations
    runMigrations(db);

    // Verify tables exist
    const tables = db
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();

    const tableNames = tables
      .map((t) => t.name)
      .filter((n) => n !== "sqlite_sequence");
    logger.info(
      `Database initialized with ${tableNames.length} tables: ${tableNames.join(", ")}`,
    );

    if (tableNames.length < 14) {
      logger.warn(
        `Expected at least 14 tables, found ${tableNames.length}. Some tables may be missing.`,
      );
    }
  } catch (error) {
    logger.error("Failed to initialize database:", error);
    throw error;
  }
}

export function checkDatabaseIntegrity(): { ok: boolean; result: string } {
  try {
    const result = db
      .query<{ integrity_check: string }, []>("PRAGMA integrity_check")
      .get();
    const isOk = result?.integrity_check === "ok";

    if (!isOk) {
      logger.error(
        `Database integrity check FAILED: ${result?.integrity_check}`,
      );
    } else {
      logger.info("Database integrity check passed");
    }

    return { ok: isOk, result: result?.integrity_check ?? "unknown" };
  } catch (error) {
    logger.error("Database integrity check threw error:", error);
    return { ok: false, result: String(error) };
  }
}

export function getDatabaseStats(): Record<string, number> {
  const stats: Record<string, number> = {};

  const tables = [
    "jobs_raw",
    "jobs_canonical",
    "job_duplicates",
    "applications",
    "notifications",
    "alerts_retry_queue",
    "connector_retry_queue",
    "source_metrics",
    "connector_checkpoints",
    "schema_fingerprints",
    "cse_key_usage",
    "run_log",
    "discovered_boards",
    "board_poll_state",
    "_migrations",
  ];

  for (const table of tables) {
    try {
      const result = db
        .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${table}`)
        .get();
      stats[table] = result?.count ?? 0;
    } catch {
      stats[table] = -1; // Table doesn't exist
    }
  }

  return stats;
}

export function quickHealthCheck(): boolean {
  try {
    const result = db.query<{ ok: number }, []>("SELECT 1 as ok").get();
    return result?.ok === 1;
  } catch {
    return false;
  }
}

export { db, DB_PATH, SCHEMA_VERSION };
