/**
 * LLM invocation step
 * Uses Edwin's native auth resolution (resolveApiKeyForProvider) and fetch()
 * for lightweight API calls — no curl, no temp files, no child processes.
 */

import type { LLMStep, StepContext, LLMStepOutput } from "../types.js";
import { VariableResolver } from "../resolver.js";
import { getStaleProfileWarning } from "./profile-check.js";

const ANTHROPIC_DEFAULT = "claude-haiku-4-5";
const OPENAI_DEFAULT = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Resolve API credentials using Edwin's auth system.
 * Falls back to environment variables if the auth module isn't available.
 */
async function resolveAuth(provider: "anthropic" | "openai"): Promise<{
  apiKey: string;
  source: string;
} | null> {
  // Try Edwin's native auth resolution first
  try {
    const { resolveApiKeyForProvider } = await import(
      process.env.EDWINPAI_MODEL_AUTH_MODULE ?? "@edwinpai/edwinpai/dist/agents/model-auth.js"
    );
    const resolved = await resolveApiKeyForProvider({ provider });
    if (resolved?.apiKey) {
      return { apiKey: resolved.apiKey, source: resolved.source ?? provider };
    }
  } catch {
    // Auth module not available (e.g. running standalone) — fall through to env vars
  }

  // Fallback: environment variables
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (key) return { apiKey: key, source: "env:ANTHROPIC_API_KEY" };
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (key) return { apiKey: key, source: "env:OPENAI_API_KEY" };
  }

  return null;
}

/**
 * Call Anthropic Messages API via fetch()
 */
async function callAnthropic(prompt: string, model: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const errMsg = (() => {
        try {
          return JSON.parse(body)?.error?.message;
        } catch {
          return body.slice(0, 200);
        }
      })();
      throw new Error(`Anthropic API ${response.status}: ${errMsg}`);
    }

    const data = (await response.json()) as any;
    return (
      data.content
        ?.filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n") || ""
    );
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call OpenAI Chat Completions API via fetch()
 */
async function callOpenAI(prompt: string, model: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeLLMStep(step: LLMStep, context: StepContext): Promise<LLMStepOutput> {
  const resolver = new VariableResolver(context.env, context.previousOutputs);

  let input = "";
  if (step.input) {
    const resolved = resolver.resolveReference(step.input);
    input = typeof resolved === "string" ? resolved : JSON.stringify(resolved, null, 2);
  }

  // Check for stale profiles and inject warning into prompt
  const staleWarning = await getStaleProfileWarning().catch(() => "");
  const promptParts = [step.llm];
  if (staleWarning) {
    promptParts.push(`\n\n${staleWarning}`);
  }
  if (input) {
    promptParts.push(`\n\nData:\n${input}`);
  }
  const prompt = promptParts.join("");
  const requestedModel = step.model || ANTHROPIC_DEFAULT;

  try {
    // Try Anthropic first
    const anthropicAuth = await resolveAuth("anthropic");
    if (anthropicAuth) {
      const model = requestedModel.startsWith("gpt-") ? ANTHROPIC_DEFAULT : requestedModel;
      try {
        const output = await callAnthropic(prompt, model, anthropicAuth.apiKey);
        return {
          success: true,
          data: { output, provider: "anthropic", source: anthropicAuth.source },
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        console.error(`[workflows] Anthropic failed (${anthropicAuth.source}): ${err.message}`);
      }
    }

    // Fallback: OpenAI
    const openaiAuth = await resolveAuth("openai");
    if (openaiAuth) {
      const model = requestedModel.startsWith("claude") ? OPENAI_DEFAULT : requestedModel;
      const output = await callOpenAI(prompt, model, openaiAuth.apiKey);
      return {
        success: true,
        data: { output, provider: "openai", source: openaiAuth.source },
        timestamp: new Date().toISOString(),
      };
    }

    return {
      success: false,
      error:
        "No LLM backend available. Configure Anthropic/OpenAI auth profiles or set API key env vars.",
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `LLM call failed: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}
