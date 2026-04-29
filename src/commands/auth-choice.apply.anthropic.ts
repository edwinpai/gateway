import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceAnthropic(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (
    params.authChoice === "setup-token" ||
    params.authChoice === "oauth" ||
    params.authChoice === "token"
  ) {
    return await applyAuthChoicePluginProvider(params, {
      authChoice: params.authChoice,
      pluginId: "provider-auth",
      providerId: "anthropic",
      methodId: "setup-token",
      label: "Anthropic",
    });
  }

  if (
    params.authChoice === "apiKey" &&
    (!params.opts?.tokenProvider || params.opts.tokenProvider === "anthropic")
  ) {
    return await applyAuthChoicePluginProvider(params, {
      authChoice: "apiKey",
      pluginId: "provider-auth",
      providerId: "anthropic",
      methodId: "api-key",
      label: "Anthropic",
    });
  }

  return null;
}
