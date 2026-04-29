# @edwinpai/shad-core

Private shad-core workspace seam for EdwinPAI.

## Status

This package currently exists as the **first truthful private workspace boundary** for the future shad-core extraction.

Today it is intentionally minimal:

- it establishes the package location and manifest shape in the workspace
- it now owns the first real engine-side seam: the engine runtime / fallback wrapper
- it does **not** yet imply that the full engine-side memory cluster has fully moved behind the package
- it does **not** imply a public npm distribution or compiled/native runtime yet

## Intended direction

As subsequent subtasks land, this package will become the home for the protected engine-side memory runtime cluster, while Edwin root code keeps:

- host wrappers/adapters
- public memory entrypoints
- config/policy/workspace-specific glue
- user-facing orchestration

## Non-goals

This package should not be treated as a complete memory-system move on day one.
