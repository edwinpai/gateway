import { createHash } from "node:crypto";

export type PermissionToken = {
  scope: string;
  certHash: string;
  txid?: string;
  assetId?: string;
  amount?: string;
  prevTxid?: string;
  commitment?: string;
  proof?: string;
};

type PermissionTokenProofPackage = {
  tx?: string;
  rawTx?: string;
  transaction?: string;
  txid?: string;
  merkleProof?: unknown;
  proof?: unknown;
  path?: unknown;
  header?: string;
  blockHeader?: string;
};

export type TokenScopeResolution =
  | { ok: true; scopes: string[] }
  | { ok: false; scopes: string[]; reason: string };

export type TokenOwnershipResult = { ok: true } | { ok: false; reason: string };
export type TokenProofResult = { ok: true } | { ok: false; reason: string };
export type TokenProofRemoteResult = TokenProofResult;

export function resolveScopesFromTokens(params: {
  requestedScopes: string[];
  tokens: PermissionToken[];
  certHash?: string;
}): TokenScopeResolution {
  const { requestedScopes, tokens, certHash } = params;
  if (tokens.length === 0) {
    return { ok: false, scopes: [], reason: "no permission tokens provided" };
  }

  if (certHash) {
    const mismatched = tokens.find((token) => token.certHash !== certHash);
    if (mismatched) {
      return {
        ok: false,
        scopes: tokens.map((token) => token.scope),
        reason: "permission token certHash mismatch",
      };
    }
  }

  const allowed = new Set(tokens.map((token) => token.scope));
  const disallowed = requestedScopes.filter((scope) => !allowed.has(scope));
  if (disallowed.length > 0) {
    return {
      ok: false,
      scopes: [...allowed],
      reason: `scopes not authorized by permission tokens: ${disallowed.join(", ")}`,
    };
  }

  return { ok: true, scopes: [...allowed] };
}

export function verifyPermissionTokenOwnership(params: {
  tokens: PermissionToken[];
  certHash?: string;
}): TokenOwnershipResult {
  const { tokens, certHash } = params;
  if (tokens.length === 0) {
    return { ok: false, reason: "no permission tokens provided" };
  }

  if (!certHash) {
    return { ok: false, reason: "signed prompt certHash missing" };
  }

  for (const token of tokens) {
    if (token.certHash !== certHash) {
      return { ok: false, reason: "permission token certHash mismatch" };
    }
    if (!token.commitment || !token.assetId || !token.amount || !token.prevTxid) {
      return { ok: false, reason: "permission token commitment fields missing" };
    }

    const expected = sha256(`${token.assetId}|${token.amount}|${token.certHash}|${token.prevTxid}`);
    if (expected !== token.commitment) {
      return { ok: false, reason: "permission token commitment mismatch" };
    }
  }

  return { ok: true };
}

export function verifyPermissionTokenProofs(params: {
  tokens: PermissionToken[];
}): TokenProofResult {
  const { tokens } = params;
  if (tokens.length === 0) {
    return { ok: false, reason: "no permission tokens provided" };
  }

  for (const token of tokens) {
    if (!token.txid) {
      return { ok: false, reason: "permission token txid missing" };
    }
    if (!token.proof) {
      return { ok: false, reason: "permission token proof missing" };
    }

    const proofPackage = parseProofPackage(token.proof);
    if (!proofPackage) {
      return { ok: false, reason: "permission token proof must be JSON (BRC-0067 package)" };
    }

    const txHex = extractTxHex(proofPackage);
    if (!txHex) {
      return { ok: false, reason: "permission token proof missing transaction hex" };
    }

    const computedTxid = computeTxidFromRawTx(txHex);
    if (computedTxid !== token.txid) {
      return { ok: false, reason: "permission token txid mismatch" };
    }

    if (!hasMerkleProof(proofPackage)) {
      return { ok: false, reason: "permission token proof missing merkle data" };
    }
  }

  return { ok: true };
}

export async function verifyPermissionTokenProofsRemote(params: {
  tokens: PermissionToken[];
  url?: string;
  timeoutMs?: number;
}): Promise<TokenProofRemoteResult> {
  const { tokens, url, timeoutMs } = params;
  if (!url) {
    return { ok: false, reason: "permission token proof verifier not configured" };
  }
  if (tokens.length === 0) {
    return { ok: false, reason: "no permission tokens provided" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 5000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokens }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `proof verifier http ${res.status}` };
    }
    const data = (await res.json()) as { ok?: boolean; reason?: string };
    if (!data.ok) {
      return { ok: false, reason: data.reason ?? "proof verifier rejected" };
    }
    return { ok: true };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { ok: false, reason: "proof verifier timeout" };
    }
    return { ok: false, reason: `proof verifier error: ${(error as Error).message}` };
  } finally {
    clearTimeout(timeout);
  }
}

function parseProofPackage(raw: string): PermissionTokenProofPackage | null {
  try {
    const parsed = JSON.parse(raw) as PermissionTokenProofPackage;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractTxHex(proof: PermissionTokenProofPackage): string | null {
  const txHex = proof.tx ?? proof.rawTx ?? proof.transaction;
  if (typeof txHex === "string" && txHex.length > 0) {
    return txHex;
  }
  return null;
}

function hasMerkleProof(proof: PermissionTokenProofPackage): boolean {
  return Boolean(
    proof.merkleProof ?? proof.proof ?? proof.path ?? proof.header ?? proof.blockHeader,
  );
}

export function computeTxidFromRawTx(rawTxHex: string): string {
  const bytes = Buffer.from(rawTxHex, "hex");
  const first = createHash("sha256").update(bytes).digest();
  const second = createHash("sha256").update(first).digest();
  return Buffer.from([...second].toReversed()).toString("hex");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
