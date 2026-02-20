export type TitleBucket = "include" | "reject" | "maybe";

export type WorkMode = "onsite" | "hybrid" | "remote" | "unknown";

export type ScoreBandKey = "topPriority" | "goodMatch" | "worthALook";

export type TimestampConfidence = "high" | "medium" | "low";

export type JobStatus =
  | "active"
  | "applied"
  | "dismissed"
  | "expired"
  | "archived";

export interface RawJob {
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  url: string;
  locationRaw: string;
  postedAt: string | null;
  originalTimezone: string | null;
  content: string; // Job description HTML/text for fingerprinting
  rawPayload: string; // Original JSON string from API
}

export interface CanonicalJob {
  title: string;
  company: string;
  source: string;
  sourceJobId: string;
  url: string;
  city: string | null;
  province: string | null;
  country: string;
  locationRaw: string;
  locationTier: string | null;
  workMode: WorkMode;
  score: number;
  scoreFreshness: number;
  scoreLocation: number;
  scoreMode: number;
  scoreBand: ScoreBandKey;
  postedAt: string | null;
  postedAtConfidence: TimestampConfidence;
  originalTimezone: string | null;
  firstSeenAt: string;
  isReposted: boolean;
  originalPostDate: string | null;
  titleBucket: TitleBucket;
  status: JobStatus;
  isBackfill: boolean;
  urlHash: string;
  contentFingerprint: string;
  rawJobId?: number;
}

export interface ConnectorResult {
  source: string;
  company: string;
  jobs: RawJob[];
  success: boolean;
  error?: string;
  responseTimeMs: number;
  rateLimited: boolean;
}

export interface PipelineRunResult {
  runId: number;
  sourcesAttempted: number;
  sourcesSucceeded: number;
  jobsFound: number;
  jobsNew: number;
  jobsDuplicate: number;
  jobsRejected: number;
  jobsMaybe: number;
  jobsAnalyzed: number;
  errors: string[];
  durationMs: number;
  instantAlertsSent: number;
}

export interface DedupResult {
  isDuplicate: boolean;
  matchMethod?: "url_hash" | "fuzzy_key" | "content_fingerprint";
  existingJobId?: number;
  isPotentialDuplicate?: boolean;
  isRepost?: boolean;
  originalPostDate?: string;
}

export interface ScoreResult {
  total: number;
  freshness: number;
  location: number;
  mode: number;
  band: ScoreBandKey;
}

export interface LocationClassification {
  city: string | null;
  province: string | null;
  tier: string | null;
  points: number;
  allLocations: string[];
}

export type BotType = "job" | "log";
export type MessageType =
  | "instant_alert"
  | "morning_digest"
  | "evening_digest"
  | "weekly_report"
  | "system_alert"
  | "spike_warning"
  | "cse_usage"
  | "schema_drift"
  | "integrity_failure"
  | "connector_retry";
