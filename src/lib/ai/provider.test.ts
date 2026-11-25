// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  AiConfigurationError,
  AiProviderError,
  DisabledEnrichmentProvider,
  EnrichmentDisabledError,
  OpenAiCompatibleEnrichmentProvider,
  resolveEnrichmentProvider,
  type FetchLike,
} from "@/lib/ai/provider";

const BASE_ENV = {
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://llm.example.test/v1",
  AI_API_KEY: "server-only-test-key",
  AI_MODEL: "fixture-model",
};

function chatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      choices: [{ index: 0, message: { role: "assistant", content } }],
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("AI enrichment provider configuration", () => {
  it("defaults to the inert disabled provider", async () => {
    const provider = resolveEnrichmentProvider({});
    expect(provider).toBeInstanceOf(DisabledEnrichmentProvider);
    expect(provider).toMatchObject({ id: "disabled", model: "none", enabled: false });
    await expect(
      provider.complete({ system: "system", user: "user" }),
    ).rejects.toBeInstanceOf(EnrichmentDisabledError);
  });

  it("accepts explicit disabled values case-insensitively", () => {
    expect(resolveEnrichmentProvider({ AI_PROVIDER: "disabled" }).enabled).toBe(false);
    expect(resolveEnrichmentProvider({ AI_PROVIDER: " DISABLED " }).enabled).toBe(false);
    expect(resolveEnrichmentProvider({ AI_PROVIDER: "" }).enabled).toBe(false);
  });

  it("fails loudly for an unsupported provider without making a call", () => {
    expect(() => resolveEnrichmentProvider({ AI_PROVIDER: "anthropic" })).toThrow(
      AiConfigurationError,
    );
    expect(() => resolveEnrichmentProvider({ AI_PROVIDER: "anthropic" })).toThrow(
      /is not implemented/,
    );
  });

  it("requires a base URL, key and model before enabling a provider", () => {
    const fetchImpl = vi.fn<FetchLike>();

    expect(() =>
      resolveEnrichmentProvider({ ...BASE_ENV, AI_BASE_URL: "" }, { fetchImpl }),
    ).toThrow(/AI_BASE_URL is required/);
    expect(() =>
      resolveEnrichmentProvider({ ...BASE_ENV, AI_API_KEY: "" }, { fetchImpl }),
    ).toThrow(/AI_API_KEY is required/);
    expect(() =>
      resolveEnrichmentProvider({ ...BASE_ENV, AI_MODEL: "" }, { fetchImpl }),
    ).toThrow(/AI_MODEL is required/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects insecure base URLs except for explicit loopback development", () => {
    expect(() =>
      resolveEnrichmentProvider({ ...BASE_ENV, AI_BASE_URL: "http://llm.example.test/v1" }),
    ).toThrow(/must use HTTPS/);
    expect(() =>
      resolveEnrichmentProvider(
        { ...BASE_ENV, AI_BASE_URL: "http://127.0.0.1:8080/v1", AI_ALLOW_INSECURE_BASE_URL: "true" },
      ),
    ).not.toThrow();
    expect(() =>
      resolveEnrichmentProvider(
        { ...BASE_ENV, AI_BASE_URL: "http://llm.example.test/v1", AI_ALLOW_INSECURE_BASE_URL: "true" },
      ),
    ).toThrow(/only permitted for a loopback/);
  });

  it("rejects credentials embedded in the base URL", () => {
    expect(() =>
      resolveEnrichmentProvider({
        ...BASE_ENV,
        AI_BASE_URL: "https://user:pass@llm.example.test/v1",
      }),
    ).toThrow(/must not contain credentials/);
  });
});

describe("OpenAI-compatible transport", () => {
  it("sends bounded chat messages and returns raw assistant text", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => chatResponse('{"ok":true}'));
    const provider = resolveEnrichmentProvider(
      { ...BASE_ENV, AI_JSON_MODE: "true", AI_MAX_OUTPUT_TOKENS: "512" },
      { fetchImpl },
    );
    expect(provider).toBeInstanceOf(OpenAiCompatibleEnrichmentProvider);
    expect(provider).toMatchObject({
      id: "openai-compatible",
      model: "fixture-model",
      enabled: true,
    });

    const content = await provider.complete({ system: "system prompt", user: "user prompt" });
    expect(content).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer server-only-test-key",
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "fixture-model",
      temperature: 0,
      max_tokens: 512,
      stream: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
    });
  });

  it("uses the OpenAI base URL and JSON mode for the openai provider", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => chatResponse("{}"));
    const provider = resolveEnrichmentProvider(
      {
        AI_PROVIDER: "openai",
        AI_API_KEY: "server-only-test-key",
        AI_MODEL: "gpt-test",
      },
      { fetchImpl },
    );
    await provider.complete({ system: "s", user: "u" });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({ response_format: { type: "json_object" } });
  });

  it("reports HTTP failures without leaking the API key", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () => new Response("upstream denied the request", { status: 401 }),
    );
    const provider = resolveEnrichmentProvider(BASE_ENV, { fetchImpl });
    const failure = provider.complete({ system: "s", user: "u" });
    await expect(failure).rejects.toBeInstanceOf(AiProviderError);
    await expect(failure).rejects.toThrow(/HTTP 401/);
    await expect(failure).rejects.not.toThrow(/server-only-test-key/);
  });

  it("rejects non-JSON, empty and malformed responses", async () => {
    for (const response of [
      new Response("not json", { status: 200 }),
      chatResponse("   "),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
    ]) {
      const provider = resolveEnrichmentProvider(BASE_ENV, {
        fetchImpl: async () => response,
      });
      await expect(provider.complete({ system: "s", user: "u" })).rejects.toBeInstanceOf(
        AiProviderError,
      );
    }
  });

  it("reports a timeout clearly and makes exactly one attempt", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw timeout;
    });
    const provider = resolveEnrichmentProvider({ ...BASE_ENV, AI_TIMEOUT_MS: "1500" }, { fetchImpl });
    await expect(provider.complete({ system: "s", user: "u" })).rejects.toThrow(
      /did not respond within 1500ms/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
