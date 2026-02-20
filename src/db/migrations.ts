import type { Database } from "bun:sqlite";
import { CREATE_TABLES_SQL } from "./schema";
import { logger } from "../logger";

interface Migration {
  id: string;
  description: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: "0001_init_schema",
    description: "Initial Phase 1 schema",
    sql: CREATE_TABLES_SQL,
  },
  {
    id: "0002_discovered_boards",
    description: "Board discovery registry for no-seed bootstrap",
    sql: `
      CREATE TABLE IF NOT EXISTS discovered_boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        board_url TEXT NOT NULL UNIQUE,
        board_slug TEXT,
        company_guess TEXT,
        confidence REAL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'active',
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        discovered_via TEXT DEFAULT 'cse'
      );

      CREATE INDEX IF NOT EXISTS idx_discovered_boards_platform_status
        ON discovered_boards(platform, status);

      CREATE TABLE IF NOT EXISTS board_poll_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL UNIQUE,
        last_success_at TEXT,
        last_cursor TEXT,
        consecutive_zero_runs INTEGER DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (board_id) REFERENCES discovered_boards(id)
      );
    `,
  },
  {
    id: "0003_job_alternate_urls",
    description: "Store alternate URLs for duplicate jobs from different sources",
    sql: `
      CREATE TABLE IF NOT EXISTS job_alternate_urls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_job_id INTEGER NOT NULL,
        alternate_url TEXT NOT NULL,
        alternate_source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (canonical_job_id) REFERENCES jobs_canonical(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_alternate_urls_job ON job_alternate_urls(canonical_job_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_alternate_urls_unique
        ON job_alternate_urls(canonical_job_id, alternate_source);
    `,
  },
  {
    id: "0004_content_fingerprint_index",
    description: "Index content fingerprint for dedup lookups",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_canonical_content_fingerprint
        ON jobs_canonical(content_fingerprint);
    `,
  },
];

function ensureMigrationTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function isApplied(db: Database, id: string): boolean {
  const row = db
    .query<{ id: string }, [string]>(
      "SELECT id FROM _migrations WHERE id = ? LIMIT 1",
    )
    .get(id);
  return !!row;
}

export function runMigrations(db: Database): void {
  ensureMigrationTable(db);

  for (const migration of MIGRATIONS) {
    if (isApplied(db, migration.id)) {
      continue;
    }

    logger.info(`Applying migration ${migration.id}: ${migration.description}`);
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.run(
        "INSERT INTO _migrations (id, description) VALUES (?, ?)",
        [migration.id, migration.description],
      );
      db.exec("COMMIT");
      logger.info(`Applied migration ${migration.id}`);
    } catch (error) {
      db.exec("ROLLBACK");
      logger.error(`Migration ${migration.id} failed:`, error);
      throw error;
    }
  }
}

