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

  _keyPool.modalKeys = keys.map((k) => ({ ...k, busy: false }));
  _keyPool.initialized = true;

  if (_keyPool.modalKeys.length > 0) {
    logger.info(
      `AI: Initialized modal key pool with ${_keyPool.modalKeys.length} key(s)`,
    );
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

function getModalProviderConfig(model?: string): AIProviderConfig {
  return {
    name: "modal",
    endpoint: "https://api.us-west-2.modal.direct/v1/chat/completions",
    model: model || "zai-org/GLM-5-FP8",
    apiKey: "", // Will be set per-request from key pool
  };
}

interface AcquiredKey {
  slot: ModalKeySlot;
  release: () => void;
}

const _waitingResolvers: Array<(value: AcquiredKey | null) => void> = [];

function releaseModalKey(slot: ModalKeySlot): void {
  slot.busy = false;
  logger.debug(`AI: [key${slot.id}] released`);
  if (_waitingResolvers.length === 0) return;

  for (let i = 0; i < _keyPool.modalKeys.length; i++) {
    const index = (_keyPool.nextKeyIndex + i) % _keyPool.modalKeys.length;
    const candidate = _keyPool.modalKeys[index];
    if (!candidate.busy) {
      candidate.busy = true;
      _keyPool.nextKeyIndex = (index + 1) % _keyPool.modalKeys.length;
      const resolver = _waitingResolvers.shift();
      if (resolver) {
        logger.info(`AI: [key${candidate.id}] acquired`);
        resolver({ slot: candidate, release: () => releaseModalKey(candidate) });
      }
      break;
    }
  }
}

async function acquireModalKey(): Promise<AcquiredKey | null> {
  if (_keyPool.modalKeys.length === 0) return null;

  const keyCount = _keyPool.modalKeys.length;
  const timeoutMs = 30000; // 30s timeout to prevent infinite loop

  for (let i = 0; i < keyCount; i++) {
    const index = (_keyPool.nextKeyIndex + i) % keyCount;
    const slot = _keyPool.modalKeys[index];

    if (!slot.busy) {
      slot.busy = true;
      _keyPool.nextKeyIndex = (index + 1) % keyCount;
      logger.info(`AI: [key${slot.id}] acquired`);
      return {
        slot,
        release: () => releaseModalKey(slot),
      };
    }
  }

  return await new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const wrappedResolver = (value: AcquiredKey | null) => {
      clearTimeout(timeoutId);
      resolve(value);
    };

    _waitingResolvers.push(wrappedResolver);

    timeoutId = setTimeout(() => {
      const index = _waitingResolvers.indexOf(wrappedResolver);
      if (index > -1) {
        _waitingResolvers.splice(index, 1);
      }
      logger.error("AI: Failed to acquire Modal key (timeout)");
      resolve(null);
    }, timeoutMs);
  });
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

const STREAM_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_REQUEST_TIMEOUT_MS = 720_000; // 12 minutes (hard limit)
const MAX_MODAL_RETRIES = 3; // 4 total attempts (initial + 3 retries)

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof reader.read>>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `AI stream stalled: no chunk received for ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

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
    msg.includes("enotfound") ||
    msg.includes("network timeout")
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
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    MAX_REQUEST_TIMEOUT_MS,
  );

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
      signal: controller.signal,
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorText = await response.text();
      const isRetryable =
        response.status === 502 ||
        response.status === 503 ||
        response.status === 429;

      if (isRetryable && retryCount < maxRetries) {
        const backoffMs = 2000 * (retryCount + 1);
        logger.warn(
          `AI: ${keyLabel}${provider.name} returned ${response.status}, retrying in ${backoffMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        return callProvider(
          provider,
          systemPrompt,
          userPrompt,
          retryCount + 1,
          maxRetries,
          keyId,
        );
      }

      logger.error(
        `AI: ${keyLabel}${provider.name} returned ${response.status}: ${errorText.substring(0, 200)}`,
      );
      return null;
    }

    if (!response.body) {
      clearTimeout(timeoutId);
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

    try {
      while (true) {
        const { done, value } = await readWithTimeout(reader, STREAM_TIMEOUT_MS);

        if (done) break;

        // Record most recent chunk for diagnostics.
        lastTokenTime = Date.now();

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
              if (firstTokenTime === null) {
                firstTokenTime = Date.now();
                logger.debug(
                  `AI: ${keyLabel}${provider.name} first token after ${firstTokenTime - startTime}ms`,
                );
              }
              content += chunk.choices[0].delta.content;
            }

            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0;
              completionTokens = chunk.usage.completion_tokens ?? 0;
            }
          } catch (err: unknown) {
            // Skip malformed JSON chunks
          }
        }
      }
    } catch (error) {
      const stalledMs = Date.now() - lastTokenTime;
      logger.error(`AI: Stream stalled for ${stalledMs}ms - aborting`);
      controller.abort();
      throw error;
    } finally {
      // Make sure underlying stream is closed even if read() is hung.
      try {
        await reader.cancel();
      } catch {
        // Ignore close errors while aborting stalled stream.
      }
    }

    clearTimeout(timeoutId);
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
    clearTimeout(timeoutId);
    if (isRetryableError(error) && retryCount < maxRetries) {
      logger.warn(
        `AI: ${keyLabel}${provider.name} connection error (${error instanceof Error ? error.message : String(error)}), retrying...`,
      );
      await new Promise((r) => setTimeout(r, 1000 * (retryCount + 1)));
      return callProvider(
        provider,
        systemPrompt,
        userPrompt,
        retryCount + 1,
        maxRetries,
        keyId,
      );
    }
    logger.error(`AI: ${keyLabel}${provider.name} call failed: ${error}`);
    return null;
  }
}

async function callModalWithKeyPool(
  systemPrompt: string,
  userPrompt: string,
  model?: string,
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
} | null> {
  const acquired = await acquireModalKey();
  if (!acquired) return null;

  const { slot, release } = acquired;

  try {
    const providerConfig = getModalProviderConfig(model);
    providerConfig.apiKey = slot.apiKey;

    return await callProvider(
      providerConfig,
      systemPrompt,
      userPrompt,
      0,
      MAX_MODAL_RETRIES,
      slot.id,
    );
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
    const modalModel = config.env.modalModel || "zai-org/GLM-5-FP8";
    const result = await callModalWithKeyPool(
      SYSTEM_PROMPT,
      userPrompt,
      modalModel,
    );

    if (result) {
      const parsed = parseAIResponse(result.content);
      if (parsed) {
        const analysis: FitAnalysis = {
          ...parsed,
          modelUsed: modalModel,
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
    const result = await callProvider(
      groqProvider,
      SYSTEM_PROMPT,
      userPrompt,
      0,
      0,
    );

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
