import { loginOpenAICodex } from "@mariozechner/pi-ai/oauth";
import type {
  AuthProfileCredential,
  ApiKeyCredential,
} from "../../src/agents/auth-profiles/types.js";
import type {
  EdwinPAIPluginApi,
  ProviderAuthContext,
  ProviderPlugin,
} from "../../src/plugins/types.js";
import {
  applyAuthProfileConfig,
  applyCloudflareAiGatewayConfig,
  applyCloudflareAiGatewayProviderConfig,
  applyGoogleGeminiModelDefault,
  applyKimiCodeConfig,
  applyKimiCodeProviderConfig,
  applyMoonshotConfig,
  applyMoonshotConfigCn,
  applyMoonshotProviderConfig,
  applyMoonshotProviderConfigCn,
  applyOpenAICodexModelDefault,
  applyOpencodeZenConfig,
  applyOpencodeZenModelDefault,
  applyOpencodeZenProviderConfig,
  applyOpenrouterConfig,
  applyOpenrouterProviderConfig,
  applySyntheticConfig,
  applySyntheticProviderConfig,
  applyVeniceConfig,
  applyVeniceProviderConfig,
  applyVercelAiGatewayConfig,
  applyVercelAiGatewayProviderConfig,
  applyXiaomiConfig,
  applyXiaomiProviderConfig,
  applyZaiConfig,
  buildTokenProfileId,
  CLOUDFLARE_AI_GATEWAY_DEFAULT_MODEL_REF,
  emptyPluginConfigSchema,
  formatApiKeyPreview,
  githubCopilotLoginCommand,
  GOOGLE_GEMINI_DEFAULT_MODEL,
  KIMI_CODING_MODEL_REF,
  loginChutes,
  MOONSHOT_DEFAULT_MODEL_REF,
  normalizeApiKeyInput,
  OPENROUTER_DEFAULT_MODEL_REF,
  OPENAI_CODEX_DEFAULT_MODEL,
  OPENCODE_ZEN_DEFAULT_MODEL,
  resolveEnvApiKey,
  SYNTHETIC_DEFAULT_MODEL_REF,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
  validateAnthropicSetupToken,
  validateApiKeyInput,
  VENICE_DEFAULT_MODEL_REF,
  XIAOMI_DEFAULT_MODEL_REF,
  ZAI_DEFAULT_MODEL_REF,
} from "../../dist/extensionAPI.js";

type ConfigMutator = (config: ProviderAuthContext["config"]) => ProviderAuthContext["config"];

function withModelConfig(
  ctx: ProviderAuthContext,
  config: ProviderAuthContext["config"],
  params: {
    defaultModel: string;
    applyDefaultConfig: ConfigMutator;
    applyProviderConfig: ConfigMutator;
  },
) {
  const next = ctx.setDefaultModel
    ? params.applyDefaultConfig(config)
    : params.applyProviderConfig(config);
  return { next, defaultModel: params.defaultModel };
}

async function promptApiKey(ctx: ProviderAuthContext, params: { provider: string; label: string }) {
  const envKey = resolveEnvApiKey(params.provider);
  if (envKey) {
    const useExisting = await ctx.prompter.confirm({
      message: `Use existing ${params.label} (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
      initialValue: true,
    });
    if (useExisting) {
      return envKey.apiKey;
    }
  }

  const key = await ctx.prompter.text({
    message: `Enter ${params.label}`,
    validate: validateApiKeyInput,
  });
  return normalizeApiKeyInput(String(key));
}

function buildApiKeyResult(params: {
  ctx: ProviderAuthContext;
  provider: string;
  profileId: string;
  key: string;
  metadata?: Record<string, string>;
  modelConfig?: {
    defaultModel: string;
    applyDefaultConfig: ConfigMutator;
    applyProviderConfig: ConfigMutator;
  };
}) {
  const credential: ApiKeyCredential = {
    type: "api_key",
    provider: params.provider,
    key: params.key,
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
  let configPatch = applyAuthProfileConfig(params.ctx.config, {
    profileId: params.profileId,
    provider: params.provider,
    mode: "api_key",
  });
  let defaultModel: string | undefined;
  if (params.modelConfig) {
    const applied = withModelConfig(params.ctx, configPatch, params.modelConfig);
    configPatch = applied.next;
    defaultModel = applied.defaultModel;
  }
  return {
    profiles: [{ profileId: params.profileId, credential }],
    configPatch,
    ...(defaultModel ? { defaultModel } : {}),
  };
}

function createApiKeyProvider(params: {
  id: string;
  label: string;
  aliases?: string[];
  envLabel: string;
  profileId: string;
  metadataPrompt?: (ctx: ProviderAuthContext) => Promise<Record<string, string>>;
  modelConfig?: {
    defaultModel: string;
    applyDefaultConfig: ConfigMutator;
    applyProviderConfig: ConfigMutator;
  };
  docsPath?: string;
}): ProviderPlugin {
  return {
    id: params.id,
    label: params.label,
    aliases: params.aliases,
    docsPath: params.docsPath,
    auth: [
      {
        id: "api-key",
        label: "API key",
        kind: "api_key",
        run: async (ctx) => {
          const key = await promptApiKey(ctx, {
            provider: params.id,
            label: params.envLabel,
          });
          const metadata = params.metadataPrompt ? await params.metadataPrompt(ctx) : undefined;
          return buildApiKeyResult({
            ctx,
            provider: params.id,
            profileId: params.profileId,
            key,
            metadata,
            modelConfig: params.modelConfig,
          });
        },
      },
    ],
  };
}

function registerProviders(api: EdwinPAIPluginApi) {
  const providers: ProviderPlugin[] = [
    {
      id: "anthropic",
      label: "Anthropic",
      aliases: ["claude"],
      auth: [
        {
          id: "setup-token",
          label: "Setup token",
          kind: "token",
          hint: "Paste a token from `claude setup-token`",
          run: async (ctx) => {
            await ctx.prompter.note(
              [
                "Run `claude setup-token` in your terminal.",
                "Then paste the generated token below.",
              ].join("\n"),
              "Anthropic setup-token",
            );
            const tokenRaw = await ctx.prompter.text({
              message: "Paste Anthropic setup-token",
              validate: (value) => validateAnthropicSetupToken(String(value ?? "")),
            });
            const profileNameRaw = await ctx.prompter.text({
              message: "Token name (blank = default)",
              placeholder: "default",
            });
            const profileId = buildTokenProfileId({
              provider: "anthropic",
              name: String(profileNameRaw ?? ""),
            });
            const credential: AuthProfileCredential = {
              type: "token",
              provider: "anthropic",
              token: String(tokenRaw).trim(),
            };
            return {
              profiles: [{ profileId, credential }],
              configPatch: applyAuthProfileConfig(ctx.config, {
                profileId,
                provider: "anthropic",
                mode: "token",
              }),
            };
          },
        },
        {
          id: "api-key",
          label: "API key",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "anthropic",
              label: "Anthropic API key",
            });
            return buildApiKeyResult({
              ctx,
              provider: "anthropic",
              profileId: "anthropic:default",
              key,
            });
          },
        },
      ],
    },
    {
      id: "openai",
      label: "OpenAI",
      auth: [
        {
          id: "api-key",
          label: "API key",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "openai",
              label: "OpenAI API key",
            });
            return buildApiKeyResult({
              ctx,
              provider: "openai",
              profileId: "openai:default",
              key,
            });
          },
        },
      ],
    },
    {
      id: "openai-codex",
      label: "OpenAI Codex",
      aliases: ["codex-cli"],
      auth: [
        {
          id: "oauth",
          label: "ChatGPT OAuth",
          kind: "oauth",
          run: async (ctx) => {
            await ctx.prompter.note(
              ctx.isRemote
                ? [
                    "You are running in a remote/VPS environment.",
                    "A URL will be shown for you to open in your LOCAL browser.",
                    "After signing in, paste the redirect URL back here.",
                  ].join("\n")
                : [
                    "Browser will open for OpenAI authentication.",
                    "If the callback doesn't auto-complete, paste the redirect URL.",
                    "OpenAI OAuth uses localhost:1455 for the callback.",
                  ].join("\n"),
              "OpenAI Codex OAuth",
            );
            const spin = ctx.prompter.progress("Starting OAuth flow…");
            try {
              const { onAuth, onPrompt } = ctx.oauth.createVpsAwareHandlers({
                isRemote: ctx.isRemote,
                prompter: ctx.prompter,
                runtime: ctx.runtime,
                spin,
                openUrl: ctx.openUrl,
                localBrowserMessage: "Complete sign-in in browser…",
              });
              const creds = await loginOpenAICodex({
                onAuth,
                onPrompt,
                onProgress: (msg) => spin.update(msg),
              });
              spin.stop("OpenAI OAuth complete");
              const credential: AuthProfileCredential = {
                type: "oauth",
                provider: "openai-codex",
                ...creds,
              };
              const applied = withModelConfig(
                ctx,
                applyAuthProfileConfig(ctx.config, {
                  profileId: "openai-codex:default",
                  provider: "openai-codex",
                  mode: "oauth",
                }),
                {
                  defaultModel: OPENAI_CODEX_DEFAULT_MODEL,
                  applyDefaultConfig: (config) => applyOpenAICodexModelDefault(config).next,
                  applyProviderConfig: (config) => config,
                },
              );
              return {
                profiles: [{ profileId: "openai-codex:default", credential }],
                configPatch: applied.next,
                defaultModel: applied.defaultModel,
              };
            } catch (err) {
              spin.stop("OpenAI OAuth failed");
              throw err;
            }
          },
        },
      ],
    },
    {
      id: "chutes",
      label: "Chutes",
      auth: [
        {
          id: "oauth",
          label: "OAuth",
          kind: "oauth",
          run: async (ctx) => {
            const redirectUri =
              process.env.CHUTES_OAUTH_REDIRECT_URI?.trim() ||
              "http://127.0.0.1:1456/oauth-callback";
            const scopes =
              process.env.CHUTES_OAUTH_SCOPES?.trim() || "openid profile chutes:invoke";
            const clientId =
              process.env.CHUTES_CLIENT_ID?.trim() ||
              String(
                await ctx.prompter.text({
                  message: "Enter Chutes OAuth client id",
                  placeholder: "cid_xxx",
                  validate: (value) => (value?.trim() ? undefined : "Required"),
                }),
              ).trim();
            const clientSecret = process.env.CHUTES_CLIENT_SECRET?.trim() || undefined;
            await ctx.prompter.note(
              ctx.isRemote
                ? [
                    "You are running in a remote/VPS environment.",
                    "A URL will be shown for you to open in your LOCAL browser.",
                    "After signing in, paste the redirect URL back here.",
                    "",
                    `Redirect URI: ${redirectUri}`,
                  ].join("\n")
                : [
                    "Browser will open for Chutes authentication.",
                    "If the callback doesn't auto-complete, paste the redirect URL.",
                    "",
                    `Redirect URI: ${redirectUri}`,
                  ].join("\n"),
              "Chutes OAuth",
            );
            const spin = ctx.prompter.progress("Starting OAuth flow…");
            try {
              const { onAuth, onPrompt } = ctx.oauth.createVpsAwareHandlers({
                isRemote: ctx.isRemote,
                prompter: ctx.prompter,
                runtime: ctx.runtime,
                spin,
                openUrl: ctx.openUrl,
                localBrowserMessage: "Complete sign-in in browser…",
              });
              const creds = await loginChutes({
                app: {
                  clientId,
                  clientSecret,
                  redirectUri,
                  scopes: scopes.split(/\s+/).filter(Boolean),
                },
                manual: ctx.isRemote,
                onAuth,
                onPrompt,
                onProgress: (msg) => spin.update(msg),
              });
              spin.stop("Chutes OAuth complete");
              const email =
                typeof creds.email === "string" && creds.email.trim()
                  ? creds.email.trim()
                  : "default";
              const profileId = `chutes:${email}`;
              const credential: AuthProfileCredential = {
                type: "oauth",
                provider: "chutes",
                ...creds,
              };
              return {
                profiles: [{ profileId, credential }],
                configPatch: applyAuthProfileConfig(ctx.config, {
                  profileId,
                  provider: "chutes",
                  mode: "oauth",
                }),
              };
            } catch (err) {
              spin.stop("Chutes OAuth failed");
              throw err;
            }
          },
        },
      ],
    },
    createApiKeyProvider({
      id: "openrouter",
      label: "OpenRouter",
      envLabel: "OpenRouter API key",
      profileId: "openrouter:default",
      modelConfig: {
        defaultModel: OPENROUTER_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyOpenrouterConfig,
        applyProviderConfig: applyOpenrouterProviderConfig,
      },
    }),
    createApiKeyProvider({
      id: "vercel-ai-gateway",
      label: "Vercel AI Gateway",
      aliases: ["ai-gateway"],
      envLabel: "Vercel AI Gateway API key",
      profileId: "vercel-ai-gateway:default",
      modelConfig: {
        defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyVercelAiGatewayConfig,
        applyProviderConfig: applyVercelAiGatewayProviderConfig,
      },
    }),
    createApiKeyProvider({
      id: "cloudflare-ai-gateway",
      label: "Cloudflare AI Gateway",
      envLabel: "Cloudflare AI Gateway API key",
      profileId: "cloudflare-ai-gateway:default",
      metadataPrompt: async (ctx) => {
        const accountId = String(
          await ctx.prompter.text({
            message: "Enter Cloudflare Account ID",
            validate: (value) => (String(value).trim() ? undefined : "Account ID is required"),
          }),
        ).trim();
        const gatewayId = String(
          await ctx.prompter.text({
            message: "Enter Cloudflare AI Gateway ID",
            validate: (value) => (String(value).trim() ? undefined : "Gateway ID is required"),
          }),
        ).trim();
        return { accountId, gatewayId };
      },
      modelConfig: {
        defaultModel: "cloudflare-ai-gateway/openai/gpt-5",
        applyDefaultConfig: applyCloudflareAiGatewayConfig,
        applyProviderConfig: applyCloudflareAiGatewayProviderConfig,
      },
    }),
    {
      id: "moonshot",
      label: "Moonshot AI",
      auth: [
        {
          id: "api-key",
          label: "API key (.ai)",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "moonshot",
              label: "Moonshot API key",
            });
            return buildApiKeyResult({
              ctx,
              provider: "moonshot",
              profileId: "moonshot:default",
              key,
              modelConfig: {
                defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
                applyDefaultConfig: applyMoonshotConfig,
                applyProviderConfig: applyMoonshotProviderConfig,
              },
            });
          },
        },
        {
          id: "api-key-cn",
          label: "API key (.cn)",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "moonshot",
              label: "Moonshot API key (.cn)",
            });
            return buildApiKeyResult({
              ctx,
              provider: "moonshot",
              profileId: "moonshot:default",
              key,
              modelConfig: {
                defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
                applyDefaultConfig: applyMoonshotConfigCn,
                applyProviderConfig: applyMoonshotProviderConfigCn,
              },
            });
          },
        },
      ],
    },
    createApiKeyProvider({
      id: "kimi-coding",
      label: "Kimi Coding",
      aliases: ["kimi-code"],
      envLabel: "Kimi Code API key",
      profileId: "kimi-coding:default",
      modelConfig: {
        defaultModel: KIMI_CODING_MODEL_REF,
        applyDefaultConfig: applyKimiCodeConfig,
        applyProviderConfig: applyKimiCodeProviderConfig,
      },
    }),
    {
      id: "google",
      label: "Google",
      auth: [
        {
          id: "api-key",
          label: "Gemini API key",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "google",
              label: "Google Gemini API key",
            });
            const baseConfig = applyAuthProfileConfig(ctx.config, {
              profileId: "google:default",
              provider: "google",
              mode: "api_key",
            });
            const applied = withModelConfig(ctx, baseConfig, {
              defaultModel: GOOGLE_GEMINI_DEFAULT_MODEL,
              applyDefaultConfig: (config) => applyGoogleGeminiModelDefault(config).next,
              applyProviderConfig: (config) => config,
            });
            return {
              profiles: [
                {
                  profileId: "google:default",
                  credential: { type: "api_key", provider: "google", key },
                },
              ],
              configPatch: applied.next,
              defaultModel: applied.defaultModel,
            };
          },
        },
      ],
    },
    createApiKeyProvider({
      id: "zai",
      label: "Z.AI",
      envLabel: "Z.AI API key",
      profileId: "zai:default",
      modelConfig: {
        defaultModel: ZAI_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyZaiConfig,
        applyProviderConfig: (config) => config,
      },
    }),
    createApiKeyProvider({
      id: "xiaomi",
      label: "Xiaomi",
      envLabel: "Xiaomi API key",
      profileId: "xiaomi:default",
      modelConfig: {
        defaultModel: XIAOMI_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyXiaomiConfig,
        applyProviderConfig: applyXiaomiProviderConfig,
      },
    }),
    createApiKeyProvider({
      id: "synthetic",
      label: "Synthetic",
      envLabel: "Synthetic API key",
      profileId: "synthetic:default",
      modelConfig: {
        defaultModel: SYNTHETIC_DEFAULT_MODEL_REF,
        applyDefaultConfig: applySyntheticConfig,
        applyProviderConfig: applySyntheticProviderConfig,
      },
    }),
    createApiKeyProvider({
      id: "venice",
      label: "Venice AI",
      envLabel: "Venice AI API key",
      profileId: "venice:default",
      modelConfig: {
        defaultModel: VENICE_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyVeniceConfig,
        applyProviderConfig: applyVeniceProviderConfig,
      },
    }),
    {
      id: "opencode",
      label: "OpenCode Zen",
      aliases: ["opencode-zen"],
      auth: [
        {
          id: "api-key",
          label: "API key",
          kind: "api_key",
          run: async (ctx) => {
            const key = await promptApiKey(ctx, {
              provider: "opencode",
              label: "OpenCode Zen API key",
            });
            const baseConfig = applyAuthProfileConfig(ctx.config, {
              profileId: "opencode:default",
              provider: "opencode",
              mode: "api_key",
            });
            const withProviderConfig = withModelConfig(ctx, baseConfig, {
              defaultModel: OPENCODE_ZEN_DEFAULT_MODEL,
              applyDefaultConfig: (config) =>
                applyOpencodeZenModelDefault(applyOpencodeZenConfig(config)).next,
              applyProviderConfig: applyOpencodeZenProviderConfig,
            });
            return {
              profiles: [
                {
                  profileId: "opencode:default",
                  credential: { type: "api_key", provider: "opencode", key },
                },
              ],
              configPatch: withProviderConfig.next,
              defaultModel: withProviderConfig.defaultModel,
            };
          },
        },
      ],
    },
    {
      id: "github-copilot",
      label: "GitHub Copilot",
      auth: [
        {
          id: "device-login",
          label: "GitHub device login",
          kind: "custom",
          run: async (ctx) => {
            await ctx.prompter.note(
              [
                "This will open a GitHub device login to authorize Copilot.",
                "Requires an active GitHub Copilot subscription.",
              ].join("\n"),
              "GitHub Copilot",
            );
            if (!process.stdin.isTTY) {
              throw new Error("GitHub Copilot login requires an interactive TTY.");
            }
            await githubCopilotLoginCommand({ yes: true }, ctx.runtime);
            let configPatch = applyAuthProfileConfig(ctx.config, {
              profileId: "github-copilot:github",
              provider: "github-copilot",
              mode: "token",
            });
            if (ctx.setDefaultModel) {
              configPatch = {
                ...configPatch,
                agents: {
                  ...configPatch.agents,
                  defaults: {
                    ...configPatch.agents?.defaults,
                    model: {
                      ...(typeof configPatch.agents?.defaults?.model === "object"
                        ? configPatch.agents.defaults.model
                        : undefined),
                      primary: "github-copilot/gpt-4o",
                    },
                  },
                },
              };
            }
            return {
              profiles: [],
              configPatch,
              defaultModel: "github-copilot/gpt-4o",
            };
          },
        },
      ],
    },
  ];

  for (const provider of providers) {
    api.registerProvider(provider);
  }
}

export default {
  id: "provider-auth",
  name: "Bundled Provider Auth",
  description: "Bundled auth providers for EdwinPAI",
  configSchema: emptyPluginConfigSchema(),
  register(api: EdwinPAIPluginApi) {
    registerProviders(api);
  },
};
