export {
  isCollectionAllowed,
  isDirectMemoryReadAllowed,
  isMemoryPathAllowed,
  normalizeAllowedCollections,
  normalizeRuntimeAttachmentPolicy,
  resolveCollectionsForRelPath,
  resolveMemoryActorType,
  resolveMemoryCapabilityTier,
  type MemoryAccessScope,
  type MemoryActorType,
  type MemoryCapabilityTier,
  type MemoryRuntimeAttachmentPolicy,
} from "./access-policy.js";
export { resolveMemoryBackendConfig } from "./backend-config.js";
