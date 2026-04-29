/**
 * BSV Authentication Module
 *
 * Implements cryptographic identity authentication for EdwinPAI based on Bitcoin SV
 * Request for Comments (BRC) specifications. Instead of traditional "crunchy shell"
 * perimeter security, this module verifies WHO is making requests via cryptographic
 * identity (Bitcoin whitepaper Section 10 privacy model).
 *
 * @module auth
 *
 * ## Quick Start
 *
 * ### Server-side: Protect an Express API
 *
 * ```typescript
 * import express from 'express';
 * import {
 *   createAuthMiddleware,
 *   createBRC107Middleware,
 *   requireCertificates,
 *   InMemoryNonceStore,
 * } from 'edwinpai/auth';
 * import { ProtoWallet } from '@bsv/sdk';
 *
 * const app = express();
 * const wallet = new ProtoWallet(); // Your BRC-100 compatible wallet
 *
 * // Basic BRC-103 authentication
 * const authMiddleware = createAuthMiddleware({
 *   wallet,
 *   maxTimestampAge: 30000,        // 30 second request window
 *   enableReplayProtection: true,   // Prevent replay attacks
 *   skipPaths: ['/health', '/public'], // Skip auth for these paths
 * });
 *
 * // Or use BRC-107/108 with certificates for stronger identity
 * const brc107Auth = createBRC107Middleware({
 *   wallet,
 *   requiredCertificateTypes: ['identity.master'],
 *   trustedCertifiers: [CERTIFIER_PUBLIC_KEY],
 * });
 *
 * app.use('/api', authMiddleware);
 * app.get('/api/protected', (req, res) => {
 *   const identity = req.bsvIdentity;
 *   res.json({ identityKey: identity?.identityKey });
 * });
 * ```
 *
 * ### Client-side: Make authenticated requests
 *
 * ```typescript
 * import {
 *   createRequestSigner,
 *   createBRC107Headers,
 *   generateNonce,
 * } from 'edwinpai/auth';
 *
 * const signer = createRequestSigner(wallet);
 *
 * // Sign and send a request
 * const { headers } = await signer.sign('POST', '/api/data', { foo: 'bar' });
 * const response = await fetch('/api/data', {
 *   method: 'POST',
 *   headers: { ...headers, 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ foo: 'bar' }),
 * });
 * ```
 *
 * ## Architecture
 *
 * This module provides two authentication approaches:
 *
 * 1. **BRC-103 Basic Auth** (`createAuthMiddleware`)
 *    - Simple signature-based authentication
 *    - Verifies identity via secp256k1 ECDSA signatures
 *    - Includes timestamp + nonce for replay protection
 *
 * 2. **BRC-107/108 Certificate Auth** (`createBRC107Middleware`)
 *    - Full identity verification with certificates
 *    - Supports selective disclosure of identity attributes
 *    - Certifier trust chains for institutional verification
 *
 * ## BRC Specifications Implemented
 *
 * - **BRC-3**: Digital Signature Creation and Verification
 * - **BRC-42**: BSV Key Derivation Scheme (BKDS)
 * - **BRC-43**: Security Levels, Protocol IDs, Key IDs and Counterparties
 * - **BRC-52**: Identity Certificates
 * - **BRC-56**: Wallet Standard Interface
 * - **BRC-100**: Wallet Interface Specification
 * - **BRC-103**: Peer-to-peer Authentication
 * - **BRC-107**: Master Certificate Types
 * - **BRC-108**: Verifiable Certificate Format
 *
 * @see {@link https://github.com/bitcoin-sv/BRCs BRC Repository}
 * @see {@link https://github.com/bitcoin-sv/ts-sdk BSV TypeScript SDK}
 */

// =============================================================================
// BRC-103 Core Middleware
// =============================================================================

/**
 * Core authentication middleware and utilities implementing BRC-103.
 *
 * @example Basic middleware setup
 * ```typescript
 * import { createAuthMiddleware, AUTH_HEADERS } from 'edwinpai/auth';
 *
 * const middleware = createAuthMiddleware({
 *   wallet: myWallet,
 *   maxTimestampAge: 30000,
 *   enableReplayProtection: true,
 *   nonceStore: new InMemoryNonceStore(60000), // 1 min cleanup
 *   skipPaths: ['/health'],
 *   onError: (result, req) => console.error('Auth failed:', result.error),
 *   onSuccess: (identity, req) => console.log('Authenticated:', identity.identityKey),
 * });
 * ```
 */
export {
  createAuthMiddleware,
  createOwnerAuthMiddleware,
  createAuthHeaders,
  createRequestSigner,
  requireIdentities,
  requireCertificates,
  requireOwner,
  InMemoryNonceStore,
  AUTH_HEADERS,
  IDENTITY_HEADERS,
  publicKeysEqual,
  type AuthenticatedRequest,
  type RequestSigner,
  type IdentityContext,
  type OwnerAuthMiddlewareOptions,
  type OwnerVerificationResult,
} from "./middleware.js";

// =============================================================================
// Identity Extraction (BRC-103)
// =============================================================================

/**
 * Identity extraction and verification utilities.
 *
 * @example Extract and verify identity manually
 * ```typescript
 * import {
 *   extractIdentityFromHeaders,
 *   verifyIdentity,
 *   extractAndVerifyIdentity,
 * } from 'edwinpai/auth';
 *
 * // Extract from request
 * const extraction = extractIdentityFromHeaders(req, req.body);
 * if (extraction.success) {
 *   const ctx = verifyIdentity(extraction.signedRequest!);
 *   console.log('Verified:', ctx.identityKey);
 * }
 *
 * // Or in one step
 * const ctx = extractAndVerifyIdentity(req, req.body);
 * ```
 */
export {
  extractIdentityFromHeaders,
  verifyIdentity,
  extractAndVerifyIdentity,
  isIdentityContext,
  type IdentityExtractionResult,
  type IdentityVerificationOptions,
} from "./identity.js";

// =============================================================================
// Owner Verification
// =============================================================================

/**
 * Owner verification utilities.
 *
 * @example Verify owner identity
 * ```typescript
 * import { verifyOwner, requireOwner, createOwnerCheck } from 'edwinpai/auth';
 *
 * // Check if identity is owner
 * const result = await verifyOwner(identityContext, {
 *   ownerPublicKey: '02abc...',
 * });
 * console.log('Is owner:', result.isOwner);
 *
 * // Assert owner (throws if not)
 * await requireOwner(identityContext, { ownerPublicKey: '02abc...' });
 * ```
 */
export {
  verifyOwner,
  requireOwner as requireOwnerCheck,
  createOwnerCheck,
  OwnerResolver,
} from "./owner.js";

// =============================================================================
// BRC-107/108 Certificate-Based Middleware
// =============================================================================

/**
 * Certificate-based authentication middleware implementing BRC-107/108.
 *
 * Provides stronger identity verification through:
 * - BRC-107 Master Certificates for identity attestation
 * - BRC-108 Verifiable Certificates with selective disclosure
 * - Certifier trust chains
 *
 * @example With required certificates
 * ```typescript
 * import { createBRC107Middleware, BRC107_HEADERS } from 'edwinpai/auth';
 *
 * const middleware = createBRC107Middleware({
 *   wallet: myWallet,
 *   requiredCertificateTypes: ['identity.master', 'kyc.basic'],
 *   trustedCertifiers: [
 *     '02abc...', // Trusted KYC provider
 *     '03def...', // Another certifier
 *   ],
 *   maxTimestampAge: 30000,
 *   maxFutureTimestamp: 5000,
 *   includeErrorDetails: process.env.NODE_ENV !== 'production',
 * });
 * ```
 */
export {
  createBRC107Middleware,
  createBRC107Headers,
  requireBRC107Certificates,
  allowBRC107Identities,
  BRC107_HEADERS,
  type BRC107AuthenticatedRequest,
  type BRC107MiddlewareOptions,
  type BRC107AuthData,
  type AuthError,
} from "./brc107-middleware.js";

// =============================================================================
// Signature Verification (BRC-3/100)
// =============================================================================

/**
 * Signature verification utilities implementing BRC-3 and BRC-100.
 *
 * @example Direct signature verification
 * ```typescript
 * import { verifySignature, verifySignedRequest, WalletVerifier } from 'edwinpai/auth';
 *
 * // Verify a signature directly
 * const isValid = verifySignature(message, signature, publicKey);
 *
 * // Verify a complete signed request
 * const result = verifySignedRequest(signedRequest, {
 *   maxTimestampAge: 30000,
 *   verifyCertificates: true,
 *   trustedCertifiers: [certifierKey],
 * });
 *
 * // Use wallet for verification
 * const verifier = new WalletVerifier(wallet);
 * const walletResult = await verifier.verifyRequest(signedRequest);
 * ```
 */
export {
  verifySignature,
  verifySignedRequest,
  publicKeyToPem,
  sha256,
  generateNonce,
  createMessageHash,
  WalletVerifier,
  type VerificationOptions,
} from "./verification.js";

// =============================================================================
// Signature Creation (BRC-3)
// =============================================================================

/**
 * Signature creation utilities implementing BRC-3.
 *
 * @example Creating signatures
 * ```typescript
 * import {
 *   signRequest,
 *   createTimestampedRequest,
 *   formatCanonicalMessage,
 * } from 'edwinpai/auth';
 *
 * // Sign via wallet
 * const response = await signRequest(wallet, {
 *   data: 'Hello, World!',
 *   protocolID: [2, 'auth'],
 *   keyID: 'primary',
 *   counterparty: 'anyone',
 *   description: 'Authentication signature',
 * });
 *
 * // Create timestamped request for replay protection
 * const request = createTimestampedRequest(
 *   'data to sign',
 *   [2, 'auth'],
 *   'primary',
 * );
 * ```
 */
export {
  signRequest,
  signDirect,
  verifyDirect,
  verifyCanonicalSignature,
  formatCanonicalMessage,
  hashForSigning,
  createSigningHash,
  createTimestampedRequest,
  isValidSignatureFormat,
  extractSignatureComponents,
  type CanonicalMessage,
  type SigningOptions,
} from "./signing.js";

// =============================================================================
// Wallet Client (BRC-56)
// =============================================================================

/**
 * Wallet communication implementing BRC-56 HTTP substrate.
 *
 * @example Creating wallet clients
 * ```typescript
 * import { WalletClient, MockWallet, createWalletClient } from 'edwinpai/auth';
 *
 * // HTTP client for remote wallet
 * const client = new WalletClient({
 *   baseUrl: 'https://wallet.example.com',
 *   timeout: 30000,
 * });
 *
 * // Or use environment variable
 * const defaultClient = createWalletClient(); // Uses BSV_WALLET_URL
 *
 * // Mock wallet for testing
 * const mockWallet = new MockWallet('02abc...');
 * ```
 */
export { WalletClient, MockWallet, createWalletClient } from "./wallet.js";
export type { WalletClientConfig } from "./wallet.js";

// =============================================================================
// Types Re-export
// =============================================================================

/**
 * All authentication-related types.
 * See `src/types/index.ts` for the complete type system.
 */
export * from "./types.js";
