import type {
  RawJob,
  CanonicalJob,
  TitleBucket,
  WorkMode,
  LocationClassification,
  TimestampConfidence,
} from "./types";
import type { AppConfig } from "./config";

// Title classification
export function classifyTitle(title: string, config: AppConfig): TitleBucket {
  const lower = title.toLowerCase();

  // Check reject patterns first (senior, staff, lead, etc.)
  for (const pattern of config.rejectTitles.patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return "reject";
    }
  }

  // Check include patterns (software engineer, developer, etc.)
  for (const pattern of config.includeTitles.patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return "include";
    }
  }

  // Check maybe/ambiguous patterns
  for (const pattern of config.maybeTitles.patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return "maybe";
    }
  }

  // If no pattern matches, reject (not a programming/engineering role)
  return "reject";
}

// Location classification
export function classifyLocation(
  locationRaw: string,
  config: AppConfig,
): LocationClassification {
  const lower = locationRaw.toLowerCase();
  const allLocations: string[] = [];
  let bestTier: string | null = null;
  let bestPoints = 0;
  let bestCity: string | null = null;
  let bestProvince: string | null = null;

  // Check all tiers from highest to lowest
  for (const [tierKey, tier] of Object.entries(config.locations.tiers)) {
    // Check main cities
    for (const city of tier.cities) {
      if (lower.includes(city.toLowerCase())) {
        allLocations.push(city);
        if (tier.points > bestPoints) {
          bestTier = tierKey;
          bestPoints = tier.points;
          bestCity = city;
          // Determine province
          bestProvince = getProvinceFromTier(tierKey);
        }
      }
    }

    // Check aliases
    for (const alias of tier.aliases) {
      if (lower.includes(alias.toLowerCase())) {
        allLocations.push(alias);
        if (tier.points > bestPoints) {
          bestTier = tierKey;
          bestPoints = tier.points;
          bestCity = alias;
          bestProvince = getProvinceFromTier(tierKey);
        }
      }
    }
  }

  return {
    city: bestCity,
    province: bestProvince,
    tier: bestTier,
    points: bestPoints,
    allLocations: [...new Set(allLocations)],
  };
}

function getProvinceFromTier(tierKey: string): string | null {
  switch (tierKey) {
    case "L1":
    case "L2":
    case "L3":
      return "Ontario";
    case "L4":
      return "British Columbia";
    case "L5":
      return null; // Remote
    default:
      return null;
  }
}

// Work mode classification
export function classifyMode(
  text: string,
  locationRaw: string,
  config: AppConfig,
): WorkMode {
  const combined = `${text} ${locationRaw}`.toLowerCase();

  // Check each mode's keywords
  // If text mentions both remote and a city, treat as hybrid
  const hasRemoteKeyword = config.modes.modes.remote.keywords.some((kw) =>
    combined.includes(kw.toLowerCase()),
  );
  const hasOnsiteKeyword = config.modes.modes.onsite.keywords.some((kw) =>
    combined.includes(kw.toLowerCase()),
  );
  const hasHybridKeyword = config.modes.modes.hybrid.keywords.some((kw) =>
    combined.includes(kw.toLowerCase()),
  );

  // Per FinalStrategy.md line 219: if remote + city, treat as hybrid
  if (hasHybridKeyword) return "hybrid";
  if (hasRemoteKeyword && hasOnsiteKeyword) return "hybrid";
  if (hasRemoteKeyword) return "remote";
  if (hasOnsiteKeyword) return "onsite";

  return "unknown";
}

// Company name normalization
const LEGAL_SUFFIXES =
  /\s*,?\s*\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|limited|incorporated|corporation|plc|gmbh|ag|sa)\s*$/i;

export function normalizeCompanyName(name: string): string {
  return name.replace(LEGAL_SUFFIXES, "").replace(/\s+/g, " ").trim();
}

// Timestamp handling
export function normalizeTimestamp(postedAt: string | null): {
  isoString: string | null;
  confidence: TimestampConfidence;
} {
  if (!postedAt) {
    return { isoString: null, confidence: "low" };
  }

  try {
    const date = new Date(postedAt);
    if (isNaN(date.getTime())) {
      return { isoString: null, confidence: "low" };
    }

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(date);
    const valueOf = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const tzName = valueOf("timeZoneName"); // e.g. GMT-5 / GMT-4
    const offsetMatch = tzName.match(/^GMT([+-]\d{1,2})(?::?(\d{2}))?$/);
    const hourOffset =
      offsetMatch?.[1].length === 2
        ? `${offsetMatch[1][0]}0${offsetMatch[1][1]}`
        : (offsetMatch?.[1] ?? "-05");
    const minOffset = offsetMatch?.[2] ?? "00";
    const offset = `${hourOffset}:${minOffset}`;

    const torontoIso = `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}T${valueOf("hour")}:${valueOf("minute")}:${valueOf("second")}${offset}`;

    // Direct API sources have high confidence timestamps
    return {
      isoString: torontoIso,
      confidence: "high",
    };
  } catch {
    return { isoString: null, confidence: "low" };
  }
}

// URL hash
export function hashUrl(url: string): string {
  const normalizedUrl = url
    .toLowerCase()
    .replace(/\/+$/, "")
    .replace(/\?.*$/, "");
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(normalizedUrl);
  return hasher.digest("hex");
}

// Content fingerprint
export function fingerprintContent(content: string): string {
  // Strip HTML, normalize whitespace
  const cleaned = content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(cleaned);
  return hasher.digest("hex");
}

// Normalize raw job to canonical
export function normalizeJob(raw: RawJob, config: AppConfig): CanonicalJob {
  const titleBucket = classifyTitle(raw.title, config);
  const location = classifyLocation(raw.locationRaw, config);
  const workMode = classifyMode(raw.content, raw.locationRaw, config);
  const company = normalizeCompanyName(raw.company);
  const { isoString: postedAt, confidence } = normalizeTimestamp(raw.postedAt);
  const urlHash = hashUrl(raw.url);
  const contentFp = fingerprintContent(raw.content);

  const now = new Date().toISOString();

  return {
    title: raw.title,
    company,
    source: raw.source,
    sourceJobId: raw.sourceJobId,
    url: raw.url,
    city: location.city,
    province: location.province,
    country: "Canada",
    locationRaw: raw.locationRaw,
    locationTier: location.tier,
    workMode,
    score: 0, // Will be set by scoring engine
    scoreFreshness: 0,
    scoreLocation: 0,
    scoreMode: 0,
    scoreBand: "worthALook",
    postedAt,
    postedAtConfidence: confidence,
    originalTimezone: raw.originalTimezone,
    firstSeenAt: now,
    isReposted: false,
    originalPostDate: null,
    titleBucket,
    status: "active",
    isBackfill: false,
    urlHash,
    contentFingerprint: contentFp,
  };
}
