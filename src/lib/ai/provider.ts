import type { EnrichmentMessages, EnrichmentProvider } from "@/lib/ai/types";

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export class EnrichmentDisabledError extends Error {
  constructor() {
    super("AI enrichment is disabled; no model call was made.");
    this.name = "EnrichmentDisabledError";
  }
}

export class AiProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;
const MAX_RESPONSE_BYTES = 512 * 1024;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

type Env = Record<string, string | undefined>;

/**
 * The default provider. It is intentionally inert: it never opens a network
 * connection and never returns model text.
 */
export class DisabledEnrichmentProvider implements EnrichmentProvider {
  readonly id = "disabled";
  readonly model = "none";
  readonly enabled = false;

  async complete(_messages: EnrichmentMessages): Promise<string> {
    throw new EnrichmentDisabledError();
  }
}

function cleanErrorText(value: string): string {
  const clean = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length <= 300 ? clean : `${clean.slice(0, 299)}…`;
}

function integerEnv(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new AiConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    throw new AiConfigurationError(`${key} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function resolveBaseUrl(provider: "openai" | "openai-compatible", env: Env): string {
  const configured = env.AI_BASE_URL?.trim();
  const raw = configured || (provider === "openai" ? DEFAULT_OPENAI_BASE_URL : "");
  if (!raw) {
    throw new AiConfigurationError(
      "AI_BASE_URL is required when AI_PROVIDER=openai-compatible. Use the server-side base URL of the compatible API.",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiConfigurationError("AI_BASE_URL must be an absolute HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new AiConfigurationError("AI_BASE_URL must not contain credentials; use AI_API_KEY.");
  }

  const allowInsecure = env.AI_ALLOW_INSECURE_BASE_URL?.trim().toLowerCase() === "true";
  if (url.protocol !== "https:") {
    if (!(allowInsecure && url.protocol === "http:" && isLoopback(url.hostname))) {
      throw new AiConfigurationError(
        "AI_BASE_URL must use HTTPS. AI_ALLOW_INSECURE_BASE_URL=true is only permitted for a loopback http:// development server.",
      );
    }
  }

  return url.toString().replace(/\/+$/, "");
}

function resolveApiKey(env: Env): string {
  const key = env.AI_API_KEY?.trim();
  if (!key) {
    throw new AiConfigurationError(
      "AI_API_KEY is required when an AI provider is enabled. It must remain server-only.",
    );
  }
  if (key.length > 512 || /\s/.test(key)) {
    throw new AiConfigurationError("AI_API_KEY must be a single non-whitespace token of 512 characters or fewer.");
  }
  return key;
}

function resolveModel(env: Env): string {
  const model = env.AI_MODEL?.trim();
  if (!model) {
    throw new AiConfigurationError("AI_MODEL is required when an AI provider is enabled.");
  }
  if (!MODEL_PATTERN.test(model)) {
    throw new AiConfigurationError(
      "AI_MODEL must start with a letter or digit and contain only letters, digits, dots, colons, slashes, underscores or hyphens.",
    );
  }
  return model;
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (Number.isFinite(size) && size > maxBytes) {
      throw new AiProviderError(`The provider response exceeded the ${maxBytes} byte limit.`, response.status);
    }
  }

  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new AiProviderError(`The provider response exceeded the ${maxBytes} byte limit.`, response.status);
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AiProviderError(`The provider response exceeded the ${maxBytes} byte limit.`, response.status);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

interface OpenAiCompatibleConfig {
  id: "openai" | "openai-compatible";
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxOutputTokens: number;
  jsonMode: boolean;
  fetchImpl?: FetchLike;
}

/**
 * Minimal OpenAI Chat Completions transport. It is deliberately not tied to a
 * vendor SDK: a compatible base URL is enough. The provider returns raw text
 * only. Validation, provenance and persistence remain outside this class.
 */
export class OpenAiCompatibleEnrichmentProvider implements EnrichmentProvider {
  readonly enabled = true;
  readonly id: OpenAiCompatibleConfig["id"];
  readonly model: string;
  private readonly config: OpenAiCompatibleConfig;

  constructor(config: OpenAiCompatibleConfig) {
    this.config = config;
    this.id = config.id;
    this.model = config.model;
  }

  async complete(messages: EnrichmentMessages): Promise<string> {
    const { config } = this;
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      temperature: 0,
      max_tokens: config.maxOutputTokens,
      stream: false,
    };
    if (config.jsonMode) body.response_format = { type: "json_object" };

    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AiProviderError(`The AI provider did not respond within ${config.timeoutMs}ms.`);
      }
      throw new AiProviderError(
        `The AI provider request failed: ${cleanErrorText(error instanceof Error ? error.message : String(error))}`,
      );
    }

    const text = await readLimitedText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      const detail = cleanErrorText(text) || "no response body";
      throw new AiProviderError(
        `The AI provider returned HTTP ${response.status}: ${detail}`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiProviderError("The AI provider returned a non-JSON response.", response.status);
    }
    if (typeof payload !== "object" || payload === null) {
      throw new AiProviderError("The AI provider returned an unexpected response shape.", response.status);
    }
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new AiProviderError("The AI provider response contained no choices.", response.status);
    }
    const first = choices[0];
    if (typeof first !== "object" || first === null) {
      throw new AiProviderError("The AI provider returned an unexpected choice.", response.status);
    }
    const message = (first as { message?: unknown }).message;
    if (typeof message !== "object" || message === null) {
      throw new AiProviderError("The AI provider response contained no message.", response.status);
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new AiProviderError("The AI provider returned empty content.", response.status);
    }
    return content;
  }
}

/**
 * Resolves the provider from server-only environment variables. The default is
 * disabled. A configured but unsupported provider fails loudly instead of
 * silently falling back, so an operator never believes a model is active.
 */
export function resolveEnrichmentProvider(
  env: Env = process.env,
  options: { fetchImpl?: FetchLike } = {},
): EnrichmentProvider {
  const configured = (env.AI_PROVIDER ?? "disabled").trim().toLowerCase();
  if (configured === "" || configured === "disabled") {
    return new DisabledEnrichmentProvider();
  }
  if (!PROVIDER_ID_PATTERN.test(configured)) {
    throw new AiConfigurationError(
      `AI_PROVIDER="${configured}" is not a valid provider identifier. Use "disabled", "openai-compatible" or "openai".`,
    );
  }
  if (configured !== "openai" && configured !== "openai-compatible") {
    throw new AiConfigurationError(
      `AI_PROVIDER="${configured}" is not implemented. Use "disabled", "openai-compatible" or "openai"; no model call was made.`,
    );
  }

  const provider = configured;
  const baseUrl = resolveBaseUrl(provider, env);
  const apiKey = resolveApiKey(env);
  const model = resolveModel(env);
  const timeoutMs = integerEnv(env, "AI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 1_000, 120_000);
  const maxOutputTokens = integerEnv(
    env,
    "AI_MAX_OUTPUT_TOKENS",
    DEFAULT_MAX_OUTPUT_TOKENS,
    64,
    8_000,
  );

  return new OpenAiCompatibleEnrichmentProvider({
    id: provider,
    model,
    baseUrl,
    apiKey,
    timeoutMs,
    maxOutputTokens,
    jsonMode: provider === "openai" || env.AI_JSON_MODE?.trim().toLowerCase() === "true",
    fetchImpl: options.fetchImpl,
  });
}
