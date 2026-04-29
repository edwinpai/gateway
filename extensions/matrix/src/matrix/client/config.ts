import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import type { CoreConfig } from "../types.js";
import type { MatrixAuth, MatrixResolvedConfig } from "./types.js";
import { getMatrixRuntime } from "../../runtime.js";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";

function clean(value?: string): string {
  return value?.trim() ?? "";
}

export function resolveMatrixConfig(
  cfg: CoreConfig = getMatrixRuntime().config.loadConfig() as CoreConfig,
  env: NodeJS.ProcessEnv = process.env,
): MatrixResolvedConfig {
  const matrix = cfg.channels?.matrix ?? {};
  const homeserver = clean(matrix.homeserver) || clean(env.MATRIX_HOMESERVER);
  const userId = clean(matrix.userId) || clean(env.MATRIX_USER_ID);
  const accessToken = clean(matrix.accessToken) || clean(env.MATRIX_ACCESS_TOKEN) || undefined;
  const password = clean(matrix.password) || clean(env.MATRIX_PASSWORD) || undefined;
  const deviceName = clean(matrix.deviceName) || clean(env.MATRIX_DEVICE_NAME) || undefined;
  const initialSyncLimit =
    typeof matrix.initialSyncLimit === "number"
      ? Math.max(0, Math.floor(matrix.initialSyncLimit))
      : undefined;
  const encryption = matrix.encryption ?? false;
  return {
    homeserver,
    userId,
    accessToken,
    password,
    deviceName,
    initialSyncLimit,
    encryption,
  };
}

export async function resolveMatrixAuth(params?: {
  cfg?: CoreConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<MatrixAuth> {
  const cfg = params?.cfg ?? (getMatrixRuntime().config.loadConfig() as CoreConfig);
  const env = params?.env ?? process.env;
  const resolved = resolveMatrixConfig(cfg, env);
  if (!resolved.homeserver) {
    throw new Error("Matrix homeserver is required (matrix.homeserver)");
  }

  const {
    loadMatrixCredentials,
    saveMatrixCredentials,
    credentialsMatchConfig,
    touchMatrixCredentials,
  } = await import("../credentials.js");

  const cached = loadMatrixCredentials(env);
  const cachedCredentials =
    cached &&
    credentialsMatchConfig(cached, {
      homeserver: resolved.homeserver,
      userId: resolved.userId || "",
    })
      ? cached
      : null;

  // If we have an access token, resolve whoami so access token + deviceId stay bound together.
  if (resolved.accessToken) {
    ensureMatrixSdkLoggingConfigured();
    const tempClient = new MatrixClient(resolved.homeserver, resolved.accessToken);
    const whoami = (await tempClient.getWhoAmI()) as {
      user_id?: string;
      device_id?: string;
    };

    const userId = (whoami.user_id?.trim() || resolved.userId || "").trim();
    if (!userId) {
      throw new Error("Matrix whoami did not return a user_id for the configured access token");
    }

    const activeDeviceId = whoami.device_id?.trim() || undefined;
    if (cachedCredentials) {
      if (cachedCredentials.accessToken !== resolved.accessToken) {
        console.warn(
          `Matrix credentials drift detected for ${userId}: configured access token differs from cached credentials` +
            `${cachedCredentials.deviceId ? ` (cached device ${cachedCredentials.deviceId})` : ""}` +
            `${activeDeviceId ? `; active device ${activeDeviceId}` : ""}`,
        );
      } else {
        touchMatrixCredentials(env);
      }
    }

    saveMatrixCredentials({
      homeserver: resolved.homeserver,
      userId,
      accessToken: resolved.accessToken,
      deviceId: activeDeviceId,
    });

    return {
      homeserver: resolved.homeserver,
      userId,
      accessToken: resolved.accessToken,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (cachedCredentials) {
    touchMatrixCredentials(env);
    return {
      homeserver: cachedCredentials.homeserver,
      userId: cachedCredentials.userId,
      accessToken: cachedCredentials.accessToken,
      deviceName: resolved.deviceName,
      initialSyncLimit: resolved.initialSyncLimit,
      encryption: resolved.encryption,
    };
  }

  if (!resolved.userId) {
    throw new Error("Matrix userId is required when no access token is configured (matrix.userId)");
  }

  if (!resolved.password) {
    throw new Error(
      "Matrix password is required when no access token is configured (matrix.password)",
    );
  }

  // Login with password using HTTP API
  const loginResponse = await fetch(`${resolved.homeserver}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: resolved.userId },
      password: resolved.password,
      initial_device_display_name: resolved.deviceName ?? "Edwin Gateway",
    }),
  });

  if (!loginResponse.ok) {
    const errorText = await loginResponse.text();
    throw new Error(`Matrix login failed: ${errorText}`);
  }

  const login = (await loginResponse.json()) as {
    access_token?: string;
    user_id?: string;
    device_id?: string;
  };

  const accessToken = login.access_token?.trim();
  if (!accessToken) {
    throw new Error("Matrix login did not return an access token");
  }

  const auth: MatrixAuth = {
    homeserver: resolved.homeserver,
    userId: login.user_id ?? resolved.userId,
    accessToken,
    deviceName: resolved.deviceName,
    initialSyncLimit: resolved.initialSyncLimit,
    encryption: resolved.encryption,
  };

  saveMatrixCredentials({
    homeserver: auth.homeserver,
    userId: auth.userId,
    accessToken: auth.accessToken,
    deviceId: login.device_id,
  });

  return auth;
}
