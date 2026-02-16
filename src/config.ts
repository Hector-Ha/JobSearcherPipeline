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
}

export interface EnvConfig {
  //Job Alerts Bot
  telegramBotToken: string;
  telegramChatId: string;

  //System Logs Bot
  telegramLogBotToken: string;
  telegramLogChatId: string;

  // Google CSE API Keys (rotation)
  googleCseApiKeys: string[];

  // Google CSE Engine IDs
  googleCseEngines: Record<string, string>;

  // Runtime
  dryRun: boolean;
  timezone: string;
  nodeEnv: string;
  port: number;

  // AI Fit Analysis - Modal keys (rotation pool)
  modalApiToken: string;
  modalApiToken2: string;
  modalApiToken3: string;
  // AI Fit Analysis - Groq fallback
  groqApiKey: string;
  groqModel: string;
  aiAnalysisMinScore: number;
  aiRequestDelayMs: number;
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

function loadJsonConfig<T>(filename: string): T {
  const filepath = join(CONFIG_DIR, filename);

  if (!existsSync(filepath)) {
    throw new Error(`Config file not found: ${filepath}`);
  }

  try {
    const raw = readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse config file ${filename}: ${error}`);
  }
}

function loadEnvConfig(): EnvConfig {
  // Collect all CSE API keys
  const cseKeys: string[] = [];
  for (const [envKey, value] of Object.entries(process.env)) {
    if (!envKey.startsWith("GOOGLE_CSE_API_KEY_")) {
      continue;
    }
    if (!value || value.startsWith("AIzaSy...")) {
      continue;
    }
    cseKeys.push(value);
  }

  // Collect CSE Engine IDs
  const cseEngines: Record<string, string> = {};
  const engineMap: Record<string, string> = {
    A: "GOOGLE_CSE_ENGINE_A",
    B: "GOOGLE_CSE_ENGINE_B",
    C: "GOOGLE_CSE_ENGINE_C",
    D: "GOOGLE_CSE_ENGINE_D",
    E: "GOOGLE_CSE_ENGINE_E",
  };
  for (const [label, envKey] of Object.entries(engineMap)) {
    const value = process.env[envKey];
    if (value) {
      cseEngines[label] = value;
    }
  }

  return {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    telegramLogBotToken: process.env.TELEGRAM_LOG_BOT_TOKEN ?? "",
    telegramLogChatId: process.env.TELEGRAM_LOG_CHAT_ID ?? "",
    googleCseApiKeys: cseKeys,
    googleCseEngines: cseEngines,
    dryRun: process.env.DRY_RUN === "true",
    timezone: process.env.TZ ?? "America/Toronto",
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: parseInt(process.env.PORT ?? "3000", 10),
    modalApiToken: process.env.MODAL_API_TOKEN ?? "",
    modalApiToken2: process.env.MODAL_API_TOKEN_2 ?? "",
    modalApiToken3: process.env.MODAL_API_TOKEN_3 ?? "",
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    aiAnalysisMinScore: parseInt(process.env.AI_ANALYSIS_MIN_SCORE ?? "50", 10),
    aiRequestDelayMs: parseInt(process.env.AI_REQUEST_DELAY_MS ?? "1000", 10),
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

  // Validation warnings
  if (!env.telegramBotToken) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — alerts will not be sent");
  }
  if (!env.telegramLogBotToken) {
    logger.warn(
      "TELEGRAM_LOG_BOT_TOKEN not set — system logs will not be sent to Telegram",
    );
  }
  if (env.googleCseApiKeys.length === 0) {
    logger.warn(
      "No Google CSE API keys configured — CSE discovery will be disabled",
    );
  }
  if (env.dryRun) {
    logger.info("🧪 DRY RUN MODE — no alerts will be sent");
  }

  // Count enabled sources
  const enabledSources = Object.entries(sources.sources)
    .filter(([, s]) => s.enabled)
    .map(([name]) => name);

  // Count seed companies
  const totalCompanies =
    companies.greenhouse.length +
    companies.lever.length +
    companies.ashby.length;

  logger.info(`Config loaded successfully:`);
  logger.info(`  - ${Object.keys(locations.tiers).length} location tiers`);
  logger.info(`  - ${includeTitles.patterns.length} include title patterns`);
  logger.info(`  - ${rejectTitles.patterns.length} reject title patterns`);
  logger.info(`  - ${maybeTitles.patterns.length} ambiguous title patterns`);
  logger.info(
    `  - ${enabledSources.length} enabled sources: ${enabledSources.join(", ") || "none"}`,
  );
  logger.info(`  - ${totalCompanies} seed companies`);
  logger.info(`  - ${env.googleCseApiKeys.length} CSE API keys`);
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

// Export singleton config
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
