export type EnsureControlUiAssetsResult = {
  ok: boolean;
  built: boolean;
  message?: string;
};

export async function ensureControlUiAssetsBuilt(): Promise<EnsureControlUiAssetsResult> {
  return {
    ok: true,
    built: false,
    message: "Legacy browser Control UI has been removed; use the Edwin Desktop app.",
  };
}

export function resolveControlUiRootOverrideSync(): string | null {
  return null;
}

export function resolveControlUiRootSync(): string | null {
  return null;
}

export async function resolveControlUiDistIndexPath(): Promise<string | null> {
  return null;
}

export function resolveControlUiRepoRoot(): string | null {
  return null;
}
