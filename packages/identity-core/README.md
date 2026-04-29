# @edwinpai/identity-core

Shared identity-core interface and protected-native runtime loader for EdwinPAI.

## Status

This package is the public/shared interface layer for identity-sensitive flows.

It now ships as a buildable package with:

- compiled JS/TS interface code in `dist/`
- runtime loader seams for protected native implementations
- optional `native/` or `native-staging/` artifact directories when release workflows stage platform artifacts

## What this package is and is not

This package **does** provide:

- the stable TypeScript/JavaScript contract used by Desktop and Gateway
- fail-closed loading behavior for protected native implementations
- a place for release workflows to stage truthful platform artifacts

This package **does not** imply that a protected native addon is always bundled.

If no loadable native addon is present, the runtime either falls back to an allowed seam or remains unavailable/fail-closed depending on the caller.

## Intended scope

- identity retrieval
- public-key derivation
- request signing
- message signing
- challenge signing
- signed-envelope creation
- signature, request, and envelope verification

## Non-goals

This package should not expose raw private key export APIs for ordinary application use.
