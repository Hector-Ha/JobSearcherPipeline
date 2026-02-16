import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { logger } from "../logger";
import type { CanonicalJob } from "../types";
import type { AppConfig } from "../config";
import type { FitAnalysis, AIProviderConfig } from "./types";
import {
  SYSTEM_PROMPT,
  buildPrompt,
  stripHtml,
  truncateDescription,
  parseAIResponse,
} from "./prompt";

let _resumeCache: string | null = null;

interface ModalKeySlot {
  id: number;
  apiKey: string;
  busy: boolean;
}

interface KeyPoolState {
  modalKeys: ModalKeySlot[];
  initialized: boolean;
  nextKeyIndex: number;
}

const _keyPool: KeyPoolState = {
  modalKeys: [],
  initialized: false,
  nextKeyIndex: 0,
};

function loadResume(): string | null {
  if (_resumeCache !== null) return _resumeCache;

  const resumePath = join(import.meta.dir, "../../config/resume.md");
  if (!existsSync(resumePath)) {
    logger.warn(
      "Resume file not found at config/resume.md — AI analysis disabled",
    );
    return null;
  }

  try {
    _resumeCache = readFileSync(resumePath, "utf-8").trim();
    logger.info(`Resume loaded: ${_resumeCache.length} chars`);
    return _resumeCache;
  } catch (error) {
    logger.error(`Failed to load resume: ${error}`);
    return null;
  }
}

export function initKeyPool(config: AppConfig): void {
  if (_keyPool.initialized) return;

  const keys: { id: number; apiKey: string }[] = [];
  
  if (config.env.modalApiToken) {
    keys.push({ id: 1, apiKey: config.env.modalApiToken });
  }
  if (config.env.modalApiToken2) {
    keys.push({ id: 2, apiKey: config.env.modalApiToken2 });
  }
  if (config.env.modalApiToken3) {
    keys.push({ id: 3, apiKey: config.env.modalApiToken3 });
  }

  _keyPool.modalKeys = keys.map(k => ({ ...k, busy: false }));
  _keyPool.initialized = true;

  if (_keyPool.modalKeys.length > 0) {
    logger.info(`AI: Initialized modal key pool with ${_keyPool.modalKeys.length} key(s)`);
  }
}

export function getModalKeyCount(): number {
  return _keyPool.modalKeys.length;
}

function getGroqProvider(config: AppConfig): AIProviderConfig | null {
  if (!config.env.groqApiKey) return null;
  
  return {
    name: "groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    model: config.env.groqModel,
    apiKey: config.env.groqApiKey,
  };
}

function getModalProviderConfig(): AIProviderConfig {
  return {
    name: "modal",
    endpoint: "https://api.us-west-2.modal.direct/v1/chat/completions",
    model: "zai-org/GLM-5-FP8",
    apiKey: "", // Will be set per-request from key pool
  };
}

interface AcquiredKey {
  slot: ModalKeySlot;
  release: () => void;
}

async function acquireModalKey(): Promise<AcquiredKey | null> {
  if (_keyPool.modalKeys.length === 0) return null;

  const keyCount = _keyPool.modalKeys.length;

  while (true) {
    // Try to find a free key starting from nextKeyIndex (round-robin)
    for (let i = 0; i < keyCount; i++) {
      const index = (_keyPool.nextKeyIndex + i) % keyCount;
      const slot = _keyPool.modalKeys[index];

      if (!slot.busy) {
        slot.busy = true;
        // Move next pointer to the following key for fair distribution
        _keyPool.nextKeyIndex = (index + 1) % keyCount;
        logger.info(`AI: [key${slot.id}] acquired`);
        return {
          slot,
          release: () => {
            slot.busy = false;
            logger.debug(`AI: [key${slot.id}] released`);
          },
        };
      }
    }

    // All keys busy, wait and retry
    await new Promise(r => setTimeout(r, 200));
  }
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const STREAM_TIMEOUT_MS = 60_000;
const MAX_MODAL_RETRIES = 3; // 4 total attempts (initial + 3 retries)

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const msg = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    msg.includes("unable to connect") ||
    msg.includes("typo in the url or port") ||
    msg.includes("socket connection was closed") ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound")
  );
}

async function callProvider(
  provider: AIProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  retryCount = 0,
  maxRetries = MAX_MODAL_RETRIES,
  keyId?: number,
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
} | null> {
  const keyLabel = keyId !== undefined ? `[key${keyId}] ` : "";
  try {
    logger.info(
      `AI: ${keyLabel}calling ${provider.name} (${provider.model})${retryCount > 0 ? ` retry ${retryCount}` : ""}...`,
    );
    const startTime = Date.now();

    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0.3,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const isRetryable = response.status === 502 || response.status === 503 || response.status === 429;
      
      if (isRetryable && retryCount < maxRetries) {
        const backoffMs = 2000 * (retryCount + 1);
        logger.warn(
          `AI: ${keyLabel}${provider.name} returned ${response.status}, retrying in ${backoffMs}ms...`,
        );
        await new Promise(r => setTimeout(r, backoffMs));
        return callProvider(provider, systemPrompt, userPrompt, retryCount + 1, maxRetries, keyId);
      }
      
      logger.error(
        `AI: ${keyLabel}${provider.name} returned ${response.status}: ${errorText.substring(0, 200)}`,
      );
      return null;
    }

    if (!response.body) {
      logger.error(`AI: ${keyLabel}${provider.name} returned no body`);
      return null;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let content = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let buffer = "";
    let firstTokenTime: number | null = null;
    let lastTokenTime = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data) as StreamChunk;

          if (chunk.choices?.[0]?.delta?.content) {
            const now = Date.now();
            
            if (firstTokenTime === null) {
              firstTokenTime = now;
              logger.debug(
                `AI: ${keyLabel}${provider.name} first token after ${firstTokenTime - startTime}ms`,
              );
            }

            if (now - lastTokenTime > STREAM_TIMEOUT_MS) {
              logger.warn(`AI: ${keyLabel}${provider.name} stream stall detected (${now - lastTokenTime}ms since last token)`);
            }
            
            lastTokenTime = now;
            content += chunk.choices[0].delta.content;
          }

          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0;
            completionTokens = chunk.usage.completion_tokens ?? 0;
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    const elapsed = Date.now() - startTime;

    if (!content) {
      logger.error(`AI: ${keyLabel}${provider.name} returned empty content`);
      return null;
    }

    logger.info(
      `AI: ${keyLabel}${provider.name} responded in ${elapsed}ms ` +
        `(${promptTokens} prompt + ${completionTokens} completion tokens)`,
    );

    return { content, promptTokens, completionTokens };
  } catch (error) {
    if (isRetryableError(error) && retryCount < maxRetries) {
      logger.warn(`AI: ${keyLabel}${provider.name} connection error, retrying...`);
      await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
      return callProvider(provider, systemPrompt, userPrompt, retryCount + 1, maxRetries, keyId);
    }
    logger.error(`AI: ${keyLabel}${provider.name} call failed: ${error}`);
    return null;
  }
}

async function callModalWithKeyPool(
  systemPrompt: string,
  userPrompt: string,
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
} | null> {
  const acquired = await acquireModalKey();
  if (!acquired) return null;

  const { slot, release } = acquired;

  try {
    const providerConfig = getModalProviderConfig();
    providerConfig.apiKey = slot.apiKey;

    return await callProvider(providerConfig, systemPrompt, userPrompt, 0, MAX_MODAL_RETRIES, slot.id);
  } finally {
    release();
  }
}

export async function analyzeFit(
  job: CanonicalJob,
  jobDescriptionHtml: string,
  config: AppConfig,
): Promise<FitAnalysis | null> {
  if (config.env.dryRun) {
    logger.info(
      `[DRY RUN] Would analyze fit for: ${job.title} @ ${job.company}`,
    );
    return null;
  }

  initKeyPool(config);

  const resume = loadResume();
  if (!resume) return null;

  const cleanDescription = truncateDescription(stripHtml(jobDescriptionHtml));
  const userPrompt = buildPrompt(
    resume,
    job.title,
    job.company,
    cleanDescription,
  );

  // Try Modal via key pool first
  if (_keyPool.modalKeys.length > 0) {
    const result = await callModalWithKeyPool(SYSTEM_PROMPT, userPrompt);
    
    if (result) {
      const parsed = parseAIResponse(result.content);
      if (parsed) {
        const analysis: FitAnalysis = {
          ...parsed,
          modelUsed: "zai-org/GLM-5-FP8",
          provider: "modal",
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
        logger.info(
          `AI: Fit score ${analysis.fitScore}/100 (${analysis.verdict}) for ${job.title} @ ${job.company}`,
        );
        return analysis;
      }
      logger.error("AI: Failed to parse modal response");
      logger.debug(`AI: Raw response: ${result.content.substring(0, 500)}`);
    }
  }

  // Fallback to Groq (single attempt, no retries)
  const groqProvider = getGroqProvider(config);
  if (groqProvider) {
    logger.info("AI: Falling back to Groq...");
    const result = await callProvider(groqProvider, SYSTEM_PROMPT, userPrompt, 0, 0);
    
    if (result) {
      const parsed = parseAIResponse(result.content);
      if (parsed) {
        const analysis: FitAnalysis = {
          ...parsed,
          modelUsed: groqProvider.model,
          provider: "groq",
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
        logger.info(
          `AI: Fit score ${analysis.fitScore}/100 (${analysis.verdict}) for ${job.title} @ ${job.company}`,
        );
        return analysis;
      }
      logger.error("AI: Failed to parse groq response");
      logger.debug(`AI: Raw response: ${result.content.substring(0, 500)}`);
    }
  }

  logger.error("AI: All providers failed — skipping fit analysis");
  return null;
}

export type { FitAnalysis } from "./types";
