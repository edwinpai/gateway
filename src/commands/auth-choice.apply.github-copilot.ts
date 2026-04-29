import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceGitHubCopilot(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "github-copilot") {
    return null;
  }

  return await applyAuthChoicePluginProvider(params, {
    authChoice: "github-copilot",
    pluginId: "provider-auth",
    providerId: "github-copilot",
    methodId: "device-login",
    label: "GitHub Copilot",
  });
}
