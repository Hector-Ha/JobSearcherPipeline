import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "./logger";

export interface LocationTier {
  label: string;
  points: number;
  cities: string[];
  aliases: string[];
}

export interface LocationConfig {
  tiers: Record<string, LocationTier>;
}

export interface TitleConfig {
  description: string;
  patterns: string[];
}

export interface ModeEntry {
  points: number;
  keywords: string[];
}

export interface ModeConfig {
  description: string;
  modes: Record<string, ModeEntry>;
}

export interface FreshnessBracket {
  maxHours: number | null;
  points: number;
  label: string;
}

export interface ScoreBand {
  emoji: string;
  label: string;
  minScore: number;
  maxScore: number;
  action: string;
}

export interface ScoringConfig {
  description: string;
  weights: {
    freshness: number;
    location: number;
    mode: number;
  };
  freshness: {
    description: string;
    brackets: FreshnessBracket[];
    lowConfidenceCap: number;
    lowConfidenceNote: string;
  };
  bands: Record<string, ScoreBand>;
}

export interface RateLimiting {
  delayBetweenRequestsMs: number;
  batchSize: number;
  batchPauseMs: number;
  maxRetries: number;
  backoffStartMs: number;
}

export interface SourceDefinition {
  type: string;
  phase: number;
  enabled: boolean;
  schedule: string;
  scheduleDescription: string;
  endpointTemplate?: string;
  urlTemplate?: string;
  purpose?: string;
  queries?: string[];
  rateLimiting?: RateLimiting;
  timeoutMs: number;
}

export interface SourceConfig {
  description: string;
  sources: Record<string, SourceDefinition>;
}

export interface CompaniesConfig {
  description: string;
  greenhouse: string[];
  lever: string[];
  ashby: string[];
  workable: string[];
  smartrecruiters: string[];
  bamboohr: string[];
  workday: string[];
  icims: string[];
}

export interface EnvConfig {
  telegramBotToken: string;
  telegramChatId: string;
  telegramLogBotToken: string;
  telegramLogChatId: string;
  serpApiKeys: string[];
  dryRun: boolean;
  timezone: string;
  nodeEnv: string;
  port: number;
  modalApiToken: string;
  modalApiToken2: string;
  modalApiToken3: string;
  modalModel?: string;
  groqApiKey: string;
  groqModel: string;
  aiAnalysisMinScore: number;
  aiRequestDelayMs: number;
  maxJobAgeDays: number;
}

export interface AppConfig {
  env: EnvConfig;
  locations: LocationConfig;
  includeTitles: TitleConfig;
  rejectTitles: TitleConfig;
  maybeTitles: TitleConfig;
  modes: ModeConfig;
  scoring: ScoringConfig;
  sources: SourceConfig;
  companies: CompaniesConfig;
}

const CONFIG_DIR = join(import.meta.dir, "../config");

function parseEnvInt(
  value: string | undefined,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return fallback;

  if (typeof min === "number" && parsed < min) return min;
  if (typeof max === "number" && parsed > max) return max;
  return parsed;
}

function loadJsonConfig<T>(filename: string): T {
  const filepath = join(CONFIG_DIR, filename);

  if (!existsSync(filepath)) {
    throw new Error(`Config file not found: ${filepath}`);
  }

  try {
    const raw = readFileSync(filepath, "utf-8");
    // Strip comments while preserving string contents (avoid corrupting URLs).
    const json = raw.replace(
      /\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g,
      (match, comment) => (comment ? "" : match),
    );
    return JSON.parse(json) as T;
  } catch (error) {
    throw new Error(`Failed to parse config file ${filename}: ${error}`);
  }
}

function loadEnvConfig(): EnvConfig {
  const serpKeys: string[] = [];
  for (const [envKey, value] of Object.entries(process.env)) {
    if (!envKey.startsWith("SERPAPI_KEY_")) {
      continue;
    }
    if (!value) {
      continue;
    }
    serpKeys.push(value);
  }

  return {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    telegramLogBotToken: process.env.TELEGRAM_LOG_BOT_TOKEN ?? "",
    telegramLogChatId: process.env.TELEGRAM_LOG_CHAT_ID ?? "",
    serpApiKeys: serpKeys.length > 0 ? serpKeys : [],
    dryRun: process.env.DRY_RUN === "true",
    timezone: process.env.TZ ?? "America/Toronto",
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseEnvInt(process.env.PORT, 3000, 1, 65535),
    modalApiToken: process.env.MODAL_API_TOKEN ?? "",
    modalApiToken2: process.env.MODAL_API_TOKEN_2 ?? "",
    modalApiToken3: process.env.MODAL_API_TOKEN_3 ?? "",
    modalModel: process.env.MODAL_MODEL,
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    aiAnalysisMinScore: parseEnvInt(
      process.env.AI_ANALYSIS_MIN_SCORE,
      50,
      0,
      100,
    ),
    aiRequestDelayMs: parseEnvInt(process.env.AI_REQUEST_DELAY_MS, 1000, 0),
    maxJobAgeDays: parseEnvInt(process.env.MAX_JOB_AGE_DAYS, 14, 1, 60),
  };
}

export function loadConfig(): AppConfig {
  logger.info("Loading configuration...");

  const env = loadEnvConfig();
  const locations = loadJsonConfig<LocationConfig>("locations.json");
  const includeTitles = loadJsonConfig<TitleConfig>("include-titles.json");
  const rejectTitles = loadJsonConfig<TitleConfig>("reject-titles.json");
  const maybeTitles = loadJsonConfig<TitleConfig>("maybe-titles.json");
  const modes = loadJsonConfig<ModeConfig>("modes.json");
  const scoring = loadJsonConfig<ScoringConfig>("scoring.json");
  const sources = loadJsonConfig<SourceConfig>("sources.json");
  const companies = loadJsonConfig<CompaniesConfig>("companies.json");

  if (!env.telegramBotToken) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — alerts will not be sent");
  }
  if (!env.telegramLogBotToken) {
    logger.warn(
      "TELEGRAM_LOG_BOT_TOKEN not set — system logs will not be sent to Telegram",
    );
  }
  if (env.serpApiKeys.length === 0) {
    logger.warn(
      "No SerpApi keys configured — Board Discovery will be disabled",
    );
  }
  if (env.dryRun) {
    logger.info("🧪 DRY RUN MODE — no alerts will be sent");
  }

  const enabledSources = Object.entries(sources.sources)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  const totalCompanies =
    companies.greenhouse.length +
    companies.lever.length +
    companies.ashby.length +
    companies.workable.length +
    companies.smartrecruiters.length +
    companies.bamboohr.length +
    companies.workday.length +
    companies.icims.length;

  logger.info(`Config loaded successfully:`);
  logger.info(`  - ${Object.keys(locations.tiers).length} location tiers`);
  logger.info(`  - ${includeTitles.patterns.length} include title patterns`);
  logger.info(`  - ${rejectTitles.patterns.length} reject title patterns`);
  logger.info(`  - ${maybeTitles.patterns.length} ambiguous title patterns`);
  logger.info(
    `  - ${enabledSources.length} enabled sources: ${enabledSources.join(", ") || "none"}`,
  );
  logger.info(`  - ${totalCompanies} seed companies`);
  logger.info(`  - ${env.serpApiKeys.length} SerpApi keys`);
  logger.info(`  - Environment: ${env.nodeEnv}`);
  logger.info(`  - Timezone: ${env.timezone}`);

  return {
    env,
    locations,
    includeTitles,
    rejectTitles,
    maybeTitles,
    modes,
    scoring,
    sources,
    companies,
  };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
