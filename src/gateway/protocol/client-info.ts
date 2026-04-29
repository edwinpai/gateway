export const GATEWAY_CLIENT_IDS = {
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "edwinpai-control-ui",
  WEBCHAT: "webchat",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  MACOS_APP: "edwinpai-macos",
  IOS_APP: "edwinpai-ios",
  ANDROID_APP: "edwinpai-android",
  NODE_HOST: "node-host",
  TEST: "test",
  FINGERPRINT: "fingerprint",
  PROBE: "edwinpai-probe",
} as const;

export type GatewayClientId = (typeof GATEWAY_CLIENT_IDS)[keyof typeof GATEWAY_CLIENT_IDS];

export const LEGACY_GATEWAY_CLIENT_IDS = {
  CONTROL_UI: "edwin-control-ui",
  MACOS_APP: "edwin-macos",
  IOS_APP: "edwin-ios",
  ANDROID_APP: "edwin-android",
  PROBE: "edwin-probe",
} as const;

export type LegacyGatewayClientId =
  (typeof LEGACY_GATEWAY_CLIENT_IDS)[keyof typeof LEGACY_GATEWAY_CLIENT_IDS];

const LEGACY_TO_CURRENT: Record<string, GatewayClientId> = {
  "edwin-control-ui": "edwinpai-control-ui",
  "edwin-macos": "edwinpai-macos",
  "edwin-ios": "edwinpai-ios",
  "edwin-android": "edwinpai-android",
  "edwin-probe": "edwinpai-probe",
};

// Back-compat naming (internal): these values are IDs, not display names.
export const GATEWAY_CLIENT_NAMES = GATEWAY_CLIENT_IDS;
export type GatewayClientName = GatewayClientId;

export const GATEWAY_CLIENT_MODES = {
  WEBCHAT: "webchat",
  CLI: "cli",
  UI: "ui",
  BACKEND: "backend",
  NODE: "node",
  PROBE: "probe",
  TEST: "test",
} as const;

export type GatewayClientMode = (typeof GATEWAY_CLIENT_MODES)[keyof typeof GATEWAY_CLIENT_MODES];

export type GatewayClientInfo = {
  id: GatewayClientId;
  displayName?: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode: GatewayClientMode;
  instanceId?: string;
};

const GATEWAY_CLIENT_ID_SET = new Set<GatewayClientId>(Object.values(GATEWAY_CLIENT_IDS));
const GATEWAY_CLIENT_MODE_SET = new Set<GatewayClientMode>(Object.values(GATEWAY_CLIENT_MODES));

export function normalizeGatewayClientId(raw?: string | null): GatewayClientId | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const mapped = LEGACY_TO_CURRENT[normalized];
  if (mapped) {
    return mapped;
  }
  return GATEWAY_CLIENT_ID_SET.has(normalized as GatewayClientId)
    ? (normalized as GatewayClientId)
    : undefined;
}

export function normalizeGatewayClientName(raw?: string | null): GatewayClientName | undefined {
  return normalizeGatewayClientId(raw);
}

export function normalizeGatewayClientMode(raw?: string | null): GatewayClientMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return GATEWAY_CLIENT_MODE_SET.has(normalized as GatewayClientMode)
    ? (normalized as GatewayClientMode)
    : undefined;
}
