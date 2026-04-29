import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceOpenAI(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice === "openai-codex") {
    return await applyAuthChoicePluginProvider(params, {
      authChoice: "openai-codex",
      pluginId: "provider-auth",
      providerId: "openai-codex",
      methodId: "oauth",
      label: "OpenAI Codex",
    });
  }

  if (
    params.authChoice === "openai-api-key" ||
    (params.authChoice === "apiKey" && params.opts?.tokenProvider === "openai")
  ) {
    return await applyAuthChoicePluginProvider(params, {
      authChoice: params.authChoice,
      pluginId: "provider-auth",
      providerId: "openai",
      methodId: "api-key",
      label: "OpenAI",
    });
  }

  return null;
}
