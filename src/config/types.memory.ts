import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  qmd?: MemoryQmdConfig;
};

export type MemoryQmdConfig = {
  command?: string;
  includeDefaultMemory?: boolean;
  /** Optional embedding key to inject into qmd subprocesses as OPENAI_API_KEY. */
  embeddingApiKey?: string;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  consolidate?: MemoryQmdConsolidateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  embedInterval?: string;
  embedMinIntervalMs?: number;
  embedMaxIntervalMs?: number;
  embedTokenThreshold?: number;
};

export type MemoryQmdConsolidateConfig = {
  threshold?: number;
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
