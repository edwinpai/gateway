import type { EdwinPAIConfig } from "../config/config.js";
import { getCredentialFromVaultSync } from "../gateway/credential-vault-singleton.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

export type DiscordTokenSource = "env" | "config" | "vault" | "none";

export type DiscordTokenResolution = {
  token: string;
  source: DiscordTokenSource;
};

export function normalizeDiscordToken(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^Bot\s+/i, "");
}

export function resolveDiscordToken(
  cfg?: EdwinPAIConfig,
  opts: { accountId?: string | null; envToken?: string | null } = {},
): DiscordTokenResolution {
  const accountId = normalizeAccountId(opts.accountId);
  const discordCfg = cfg?.channels?.discord;
  const accountCfg =
    accountId !== DEFAULT_ACCOUNT_ID
      ? discordCfg?.accounts?.[accountId]
      : discordCfg?.accounts?.[DEFAULT_ACCOUNT_ID];
  const accountToken = normalizeDiscordToken(accountCfg?.token ?? undefined);
  if (accountToken) {
    return { token: accountToken, source: "config" };
  }

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const configToken = allowEnv ? normalizeDiscordToken(discordCfg?.token ?? undefined) : undefined;
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  // Try credential vault cache (pre-populated at gateway startup)
  if (allowEnv) {
    const vaultToken = normalizeDiscordToken(
      getCredentialFromVaultSync("discord-bot-token") ?? undefined,
    );
    if (vaultToken) {
      return { token: vaultToken, source: "vault" };
    }
  }

  const envToken = allowEnv
    ? normalizeDiscordToken(opts.envToken ?? process.env.DISCORD_BOT_TOKEN)
    : undefined;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: "", source: "none" };
}
