# EdwinPAI Release Notes

## v1.0.0-beta.1 (Draft)

Release date: 2026-04-03

## Summary

First public beta of EdwinPAI as a personal, local-first AI assistant runtime with multi-channel messaging, tool execution, and durable memory workflows.

## Highlights

- Local-first Gateway control plane (`edwin gateway`)
- Multi-channel assistant support (Telegram, Discord, Slack, Signal, Matrix, etc.)
- Session and routing controls for direct/group conversations
- Tooling surface for browser, canvas, nodes, cron, and messaging actions
- Voice + TTS support (provider-configurable)
- Security posture tooling via `edwin security audit`
- Operational health/status/update commands (`edwin status --deep`, `edwin update status`)

## Security and Memory Notes

- No critical findings in current audit snapshot (warnings may still exist based on environment/risk profile).
- Recommended pre-launch checks:
  - `edwin status --deep`
  - `edwin security audit --deep`
  - `edwin update status`
- Ensure your memory workflow is validated end-to-end (write → compact → retrieve).

## Known Limitations (Beta)

- Some security warnings are deployment-specific and may be acceptable in single-user/local setups.
- Feature behavior depends on channel/provider configuration and external service limits.

## Upgrade / Install

See README install instructions and docs:

- https://docs.edwinpai.com/start/getting-started
- https://docs.edwinpai.com/install/updating

## Open Source Boundary (Recommended)

Public:

- Product architecture, UX flows, non-sensitive implementation patterns
- Configuration and operator docs

Private / managed:

- Internal threat-detection heuristics and anti-abuse internals
- Sensitive operational playbooks and enforcement details
- Credentials, signing material, and secret-bearing infrastructure details

## Checks used for this draft

- `edwin status --deep`
- `edwin security audit --deep`
- `edwin update status`

---

If this file is used for a formal release, replace placeholder version/date and append future releases in reverse chronological order.
