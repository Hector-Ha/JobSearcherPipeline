import type {
  CanonicalJob,
  ScoreResult,
  ScoreBandKey,
  TimestampConfidence,
} from "../types";
import type { AppConfig } from "../config";

// Score a Single Job

export function scoreJob(job: CanonicalJob, config: AppConfig): ScoreResult {
  const freshness = scoreFreshness(
    job.postedAt,
    job.firstSeenAt,
    job.postedAtConfidence,
    config,
  );
  const location = scoreLocation(job.locationTier, config);
  const mode = scoreMode(job.workMode, config);

  const total = freshness + location + mode;
  const band = determineBand(total, config);

  return { total, freshness, location, mode, band };
}

// Freshness Scoring

export function scoreFreshness(
  postedAt: string | null,
  firstSeenAt: string,
  confidence: TimestampConfidence,
  config: AppConfig,
): number {
  // Use postedAt if available, else fall back to firstSeenAt
  const referenceTime = postedAt ?? firstSeenAt;
  const refDate = new Date(referenceTime);
  const now = new Date();
  const hoursAgo = (now.getTime() - refDate.getTime()) / (1000 * 60 * 60);

  let points = 0;

  // Sort brackets: non-null ascending, null (fallback) last
  const sorted = [...config.scoring.freshness.brackets].sort((a, b) => {
    if (a.maxHours === null) return 1;
    if (b.maxHours === null) return -1;
    return a.maxHours - b.maxHours;
  });

  for (const bracket of sorted) {
    if (bracket.maxHours === null || hoursAgo <= bracket.maxHours) {
      points = bracket.points;
      break;
    }
  }

  // Apply low-confidence cap per FinalStrategy.md line 192-193
  if (
    confidence === "low" &&
    points > config.scoring.freshness.lowConfidenceCap
  ) {
    points = config.scoring.freshness.lowConfidenceCap;
  }

  return points;
}

// Location Scoring

export function scoreLocation(
  locationTier: string | null,
  config: AppConfig,
): number {
  if (!locationTier) return 0;

  const tier = config.locations.tiers[locationTier];
  return tier?.points ?? 0;
}

// Mode Scoring

export function scoreMode(workMode: string, config: AppConfig): number {
  const modeEntry = config.modes.modes[workMode];
  return modeEntry?.points ?? config.modes.modes.unknown?.points ?? 8;
}

// Determine Score Band

export function determineBand(
  totalScore: number,
  config: AppConfig,
): ScoreBandKey {
  if (totalScore >= config.scoring.bands.topPriority.minScore) {
    return "topPriority";
  }
  if (totalScore >= config.scoring.bands.goodMatch.minScore) {
    return "goodMatch";
  }
  return "worthALook";
}
