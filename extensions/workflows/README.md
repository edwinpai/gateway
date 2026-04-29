# @edwinpai/workflows

Deterministic workflow engine for EdwinPAI — run typed, resumable pipelines for automation tasks.

## What It Does

The workflows extension is EdwinPAI's preferred automation backbone. New reliable scheduled jobs, reminders, heartbeat-style checks, and other cron-like automations should be implemented as workflows or workflow-backed presets rather than new standalone scheduling systems.

The workflows extension executes YAML-defined automation pipelines. Each workflow is a sequence of typed steps that run in order, with variable passing between steps, conditional execution, diff-based change detection, and approval gates.

Workflows are **resumable**: if a step fails or an approval is pending, the engine saves state and can resume from the last failure point.

## Step Types

| Step          | Key          | Description                                      |
| ------------- | ------------ | ------------------------------------------------ |
| **exec**      | `exec:`      | Run a shell command, capture stdout/stderr       |
| **llm**       | `llm:`       | Call an LLM (Anthropic OAuth or OpenAI fallback) |
| **message**   | `message:`   | Send a message via EdwinPAI CLI (WhatsApp, etc.) |
| **diff**      | `diff_last:` | Compare current data with the previous run       |
| **approve**   | `approve:`   | Pause until owner approves (via tool or file)    |
| **transform** | `transform:` | Run a JavaScript expression on data              |

## YAML Workflow Format

```yaml
name: my-workflow
description: Example workflow
env:
  CUSTOM_VAR: "value"

steps:
  - id: fetch
    exec: "curl -s https://api.example.com/data"
    timeout: "30s"

  - id: diff
    diff_last: true
    input: $fetch.stdout

  - id: format
    llm: "Summarize the changes in this data"
    input: $diff.diff
    model: claude-haiku-4-5
    condition: $diff.changed

  - id: notify
    message:
      to: "+1234567890"
      channel: whatsapp
      text: "Update: $format.output"
    condition: $diff.changed

  - id: review
    approve: "Please review the output before proceeding"
    input: $format.output

  - id: process
    transform: "(input) => input.split('\\n').length"
    input: $format.output
```

### Variable References

- `$stepId.field` — Reference output from a previous step (e.g., `$fetch.stdout`, `$format.output`)
- `$ENV_VAR` — Reference environment variables (all-caps names)

### Conditions

Steps can have a `condition:` field referencing a previous step's output. The step is skipped if the value is falsy.

## Workflow Definitions

Workflow YAML files live in the user workspace:

```
~/.edwinpai/workspace/workflows/
├── my-workflow.yaml
├── another-workflow.yaml
├── .state/          # persisted run state (auto-managed)
├── .history/        # run history (auto-managed)
├── .approvals/      # pending approvals (auto-managed)
├── .outbox/         # queued messages (fallback)
└── .logs/           # crontab runner logs
```

## Triggering Workflows

### Via the EdwinPAI Tool

The extension registers a `workflows` tool with actions:

- `list` — list available workflows
- `run` — execute a workflow (with optional `args` and `resume`)
- `status` — check last run status
- `history` — view run history
- `approve` / `deny` — respond to approval gates
- `pending` — list pending approvals

### Via Crontab (run.sh)

The included `run.sh` script is designed for crontab invocation from the workspace:

```bash
# In crontab:
RUNNER=$HOME/.edwinpai/workspace/workflows/run.sh

# Every 5 minutes
*/5 * * * * $RUNNER my-workflow

# Daily at 8am
0 8 * * * $RUNNER daily-report
```

The runner:

- Lives under `~/.edwinpai/workspace/workflows/run.sh`
- Sources `~/.edwinpai/.env` for API keys
- Logs to `~/.edwinpai/workspace/workflows/.logs/<name>.log`
- Uses the local Edwin workflows engine without pinning crontab entries to a repo path

> **Note:** If migrating from the old plugin location (`~/.edwinpai/workspace/plugins/workflows/`) or older repo-pinned runner paths, update your crontab `RUNNER` variable to `~/.edwinpai/workspace/workflows/run.sh`.

## LLM Backend

The `llm` step tries backends in order:

1. **Anthropic OAuth** — reads tokens from EdwinPAI's auth profiles (`~/.edwinpai/agents/main/agent/auth-profiles.json`)
2. **OpenAI** — falls back to `OPENAI_API_KEY` environment variable

Default model: `claude-haiku-4-5` (Anthropic) / `gpt-4o-mini` (OpenAI fallback).
