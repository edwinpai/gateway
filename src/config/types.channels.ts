import type { GroupPolicy } from "./types.base.js";
import type { DiscordConfig } from "./types.discord.js";
import type { SignalConfig } from "./types.signal.js";
import type { TelegramConfig } from "./types.telegram.js";
import type { WhatsAppConfig } from "./types.whatsapp.js";

export type ChannelHeartbeatVisibilityConfig = {
  /** Show HEARTBEAT_OK acknowledgments in chat (default: false). */
  showOk?: boolean;
  /** Show heartbeat alerts with actual content (default: true). */
  showAlerts?: boolean;
  /** Emit indicator events for UI status display (default: true). */
  useIndicator?: boolean;
};

export type ChannelDefaultsConfig = {
  groupPolicy?: GroupPolicy;
  /** Default heartbeat visibility for all channels. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
};

export type ChannelsConfig = {
  defaults?: ChannelDefaultsConfig;
  whatsapp?: WhatsAppConfig;
  telegram?: TelegramConfig;
  discord?: DiscordConfig;
  signal?: SignalConfig;
  [key: string]: unknown;
};
