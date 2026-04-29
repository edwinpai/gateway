import { describe, it, expect } from "vitest";
import {
  resolveScopesFromTokens,
  verifyPermissionTokenOwnership,
  verifyPermissionTokenProofs,
  computeTxidFromRawTx,
} from "../signed-prompt-tokens.js";

const rawTx =
  "0100000001" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "ffffffff" +
  "00" +
  "ffffffff" +
  "01" +
  "00f2052a01000000" +
  "00" +
  "00000000";

const txid = computeTxidFromRawTx(rawTx);
const proofPayload = JSON.stringify({
  tx: rawTx,
  merkleProof: { nodes: [] },
  header: "00",
});

describe("resolveScopesFromTokens", () => {
  it("rejects when no tokens provided", () => {
    const result = resolveScopesFromTokens({ requestedScopes: ["operator.read"], tokens: [] });
    expect(result.ok).toBe(false);
  });

  it("allows requested scopes when tokens cover them", () => {
    const result = resolveScopesFromTokens({
      requestedScopes: ["operator.read"],
      tokens: [{ scope: "operator.read", certHash: "hash" }],
      certHash: "hash",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects when certHash does not match", () => {
    const result = resolveScopesFromTokens({
      requestedScopes: ["operator.read"],
      tokens: [{ scope: "operator.read", certHash: "hash" }],
      certHash: "other",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when tokens do not cover requested scopes", () => {
    const result = resolveScopesFromTokens({
      requestedScopes: ["operator.read", "operator.write"],
      tokens: [{ scope: "operator.read", certHash: "hash" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("operator.write");
    }
  });

  it("verifies token commitment", () => {
    const assetId = "asset";
    const amount = "1";
    const certHash = "hash";
    const prevTxid = "prev";
    const commitment = "8744d254878c5ede0049a7c6e4848fa912f51cff940305cf54cb9c3a85333cf9";

    const result = resolveScopesFromTokens({
      requestedScopes: ["operator.read"],
      tokens: [
        {
          scope: "operator.read",
          certHash,
          assetId,
          amount,
          prevTxid,
          commitment,
          txid,
          proof: proofPayload,
        },
      ],
      certHash,
    });

    expect(result.ok).toBe(true);

    const ownership = verifyPermissionTokenOwnership({
      tokens: [
        {
          scope: "operator.read",
          certHash,
          assetId,
          amount,
          prevTxid,
          commitment,
          txid,
          proof: proofPayload,
        },
      ],
      certHash,
    });

    expect(ownership.ok).toBe(true);
  });

  it("rejects when commitment fields missing", () => {
    const ownership = verifyPermissionTokenOwnership({
      tokens: [
        {
          scope: "operator.read",
          certHash: "hash",
        },
      ],
      certHash: "hash",
    });

    expect(ownership.ok).toBe(false);
  });

  it("rejects when proof missing", () => {
    const proof = verifyPermissionTokenProofs({
      tokens: [
        {
          scope: "operator.read",
          certHash: "hash",
          txid: "tx",
        },
      ],
    });

    expect(proof.ok).toBe(false);
  });

  it("rejects when proof txid mismatch", () => {
    const proof = verifyPermissionTokenProofs({
      tokens: [
        {
          scope: "operator.read",
          certHash: "hash",
          txid: "deadbeef",
          proof: proofPayload,
        },
      ],
    });

    expect(proof.ok).toBe(false);
  });

  it("rejects when merkle data missing", () => {
    const proof = verifyPermissionTokenProofs({
      tokens: [
        {
          scope: "operator.read",
          certHash: "hash",
          txid,
          proof: JSON.stringify({ tx: rawTx }),
        },
      ],
    });

    expect(proof.ok).toBe(false);
  });
});
