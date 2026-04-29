/**
 * @deprecated Compatibility shim.
 *
 * The engine runtime implementation now lives behind the private shad-core
 * package seam. New engine-oriented callers should import from
 * `../../packages/shad-core/src/index.js` instead of reaching through this
 * root-memory compatibility path.
 */
export {
  instantiateMemoryEngineRuntime,
  type InstantiatedMemorySearchManager,
} from "../../packages/shad-core/src/index.js";
