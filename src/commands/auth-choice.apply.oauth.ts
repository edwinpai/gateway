import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyAuthChoicePluginProvider } from "./auth-choice.apply.plugin-provider.js";

export async function applyAuthChoiceOAuth(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "chutes") {
    return null;
  }

  return await applyAuthChoicePluginProvider(params, {
    authChoice: "chutes",
    pluginId: "provider-auth",
    providerId: "chutes",
    methodId: "oauth",
    label: "Chutes",
  });
}
