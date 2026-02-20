import { join } from "path";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { db } from "../db";
import { upsertDiscoveredBoard } from "../db/operations";
import { logger } from "../logger";

const CONFIG_DIR = join(import.meta.dir, "../../config");
const DISCOVERED_FILE = join(CONFIG_DIR, "discovered.json");

interface DiscoveredBoardJson {
  platform: string;
  boardUrl: string;
  boardSlug: string | null;
  companyGuess: string | null;
  confidence: number;
  discoveredVia: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function exportBoards() {
  logger.info("💾 Exporting discovered boards to JSON...");

  try {
    const rows = db
      .query(
        `
      SELECT platform, board_url, board_slug, company_guess, confidence, discovered_via, status, first_seen_at, last_seen_at
      FROM discovered_boards
    `,
      )
      .all() as any[];

    const data: DiscoveredBoardJson[] = rows.map((r) => ({
      platform: r.platform,
      boardUrl: r.board_url,
      boardSlug: r.board_slug,
      companyGuess: r.company_guess,
      confidence: r.confidence,
      discoveredVia: r.discovered_via,
      status: r.status,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }));

    writeFileSync(DISCOVERED_FILE, JSON.stringify(data, null, 2));
    logger.info(`✅ Saved ${data.length} boards to ${DISCOVERED_FILE}`);
  } catch (e) {
    logger.error(`❌ Failed to export boards: ${e}`);
  }
}

export function importBoards() {
  logger.info("📂 Importing discovered boards from JSON...");

  if (!existsSync(DISCOVERED_FILE)) {
    logger.info("ℹ️ No discovered.json found, skipping import.");
    return;
  }

  try {
    const raw = readFileSync(DISCOVERED_FILE, "utf-8");
    const data = JSON.parse(raw) as DiscoveredBoardJson[];
    let count = 0;

    for (const item of data) {
      upsertDiscoveredBoard({
        platform: item.platform as any,
        boardUrl: item.boardUrl,
        boardSlug: item.boardSlug,
        companyGuess: item.companyGuess,
        confidence: item.confidence,
        discoveredVia: item.discoveredVia || "unknown",
      });
      // Restore status/dates if possible (upsert resets status to active currently, which is fine)
      count++;
    }

    logger.info(`✅ Imported ${count} boards from ${DISCOVERED_FILE}`);
  } catch (e) {
    logger.error(`❌ Failed to import boards: ${e}`);
  }
}

// CLI usage
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--import")) {
    importBoards();
  } else {
    // Default to export if no flag or --export
    exportBoards();
  }
}
