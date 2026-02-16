import { logger } from "../logger";
import { initializeDatabase } from "../db";
import { loadConfig } from "../config";
import { getRawJobsForReplay, insertCanonicalJob } from "../db/operations";
import type { RawJob } from "../types";
import { normalizeJob } from "../normalizer";
import { checkDuplicate } from "../dedup";
import { scoreJob } from "../scoring";

// Parse CLI args
const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const sourceIndex = args.indexOf("--source");

const date = dateIndex !== -1 ? args[dateIndex + 1] : null;
const source = sourceIndex !== -1 ? args[sourceIndex + 1] : null;

if (!date || !source) {
  logger.error("Usage: bun run replay -- --date YYYY-MM-DD --source <source>");
  logger.error(
    "Example: bun run replay -- --date 2026-02-14 --source greenhouse",
  );
  process.exit(1);
}

logger.info(`Replay triggered — date: ${date}, source: ${source}`);

initializeDatabase();
const config = loadConfig();

const rawRows = getRawJobsForReplay(date, source);
if (rawRows.length === 0) {
  logger.warn("No raw rows found for requested date/source");
  process.exit(0);
}

let inserted = 0;
let duplicates = 0;
let failed = 0;

for (const row of rawRows) {
  try {
    const replayRaw = parseRawPayloadToRawJob(
      row.source,
      row.company ?? "unknown",
      row.raw_payload,
    );
    if (!replayRaw) {
      failed++;
      continue;
    }

    const canonical = normalizeJob(replayRaw, config);
    if (canonical.titleBucket === "reject") {
      continue;
    }

    const dedup = checkDuplicate(canonical);
    if (dedup.isDuplicate && !dedup.isPotentialDuplicate) {
      duplicates++;
      continue;
    }

    const score = scoreJob(canonical, config);
    canonical.score = score.total;
    canonical.scoreFreshness = score.freshness;
    canonical.scoreLocation = score.location;
    canonical.scoreMode = score.mode;
    canonical.scoreBand = score.band;

    insertCanonicalJob(canonical, row.id);
    inserted++;
  } catch (error) {
    failed++;
    logger.warn(`Replay failed for raw row ${row.id}: ${String(error)}`);
  }
}

logger.info(
  `Replay complete — rows: ${rawRows.length}, inserted: ${inserted}, duplicates: ${duplicates}, failed: ${failed}`,
);

function parseRawPayloadToRawJob(
  sourceName: string,
  company: string,
  rawPayload: string,
): RawJob | null {
  const parsed = JSON.parse(rawPayload) as Record<string, unknown>;

  if (sourceName === "greenhouse") {
    return {
      source: "greenhouse",
      sourceJobId: String(parsed.id ?? ""),
      title: String(parsed.title ?? ""),
      company,
      url: String(parsed.absolute_url ?? ""),
      locationRaw: String(
        (parsed.location as { name?: string } | undefined)?.name ?? "",
      ),
      postedAt: parsed.updated_at ? String(parsed.updated_at) : null,
      originalTimezone: null,
      content: String(parsed.content ?? ""),
      rawPayload,
    };
  }

  if (sourceName === "lever") {
    const categories = (parsed.categories as Record<string, unknown>) ?? {};
    const locationRaw = String(categories.location ?? "");
    return {
      source: "lever",
      sourceJobId: String(parsed.id ?? ""),
      title: String(parsed.text ?? ""),
      company,
      url: String(parsed.hostedUrl ?? ""),
      locationRaw,
      postedAt: parsed.createdAt
        ? new Date(Number(parsed.createdAt)).toISOString()
        : null,
      originalTimezone: null,
      content: String(parsed.descriptionPlain ?? parsed.description ?? ""),
      rawPayload,
    };
  }

  if (sourceName === "ashby") {
    return {
      source: "ashby",
      sourceJobId: String(parsed.id ?? ""),
      title: String(parsed.title ?? ""),
      company,
      url: String(parsed.jobUrl ?? ""),
      locationRaw: String(parsed.location ?? ""),
      postedAt: parsed.publishedAt ? String(parsed.publishedAt) : null,
      originalTimezone: null,
      content: String(parsed.descriptionPlain ?? parsed.descriptionHtml ?? ""),
      rawPayload,
    };
  }

  return null;
}
