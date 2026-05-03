#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/ci-run-triage.sh --repo OWNER/REPO --run-id RUN_ID [--out-dir DIR]

Collects GitHub Actions diagnostics for a run:
- run metadata
- job/step summary
- failed logs when GitHub exposes them
- annotations when GitHub exposes them
- a machine-readable classification for pre-step infra blockers like GitHub Actions billing

This script is intentionally best-effort: GitHub sometimes returns "log not found"
for jobs that fail before a step starts. In that case, the run/job JSON is still saved.
USAGE
}

REPO=""
RUN_ID=""
OUT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --run-id)
      RUN_ID="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$REPO" || -z "$RUN_ID" ]]; then
  usage >&2
  exit 2
fi

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR=".tmp/ci-triage/${REPO//\//-}/$RUN_ID"
fi
mkdir -p "$OUT_DIR"

printf 'Collecting CI diagnostics for %s run %s into %s\n' "$REPO" "$RUN_ID" "$OUT_DIR" >&2

gh run view "$RUN_ID" --repo "$REPO" --json \
  name,displayTitle,status,conclusion,event,headBranch,headSha,createdAt,updatedAt,url,workflowDatabaseId \
  > "$OUT_DIR/run.json"

gh api "repos/$REPO/actions/runs/$RUN_ID/jobs" --paginate > "$OUT_DIR/jobs.raw.json"
node - "$OUT_DIR/jobs.raw.json" "$OUT_DIR/jobs.json" "$OUT_DIR/jobs-summary.txt" <<'NODE'
const fs = require('node:fs');
const [rawPath, jobsPath, summaryPath] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const jobs = Array.isArray(pages.jobs) ? pages.jobs : Array.isArray(pages) ? pages.flatMap((page) => page.jobs ?? []) : [];
fs.writeFileSync(jobsPath, JSON.stringify(jobs, null, 2) + '\n');
const lines = [];
for (const job of jobs) {
  lines.push(`${job.conclusion ?? job.status}\t${job.id}\t${job.name}`);
  for (const step of job.steps ?? []) {
    if (step.conclusion === 'failure') {
      lines.push(`  failed step ${step.number}: ${step.name}`);
    }
  }
}
fs.writeFileSync(summaryPath, lines.join('\n') + '\n');
NODE
cat "$OUT_DIR/jobs-summary.txt"

if ! gh run view "$RUN_ID" --repo "$REPO" --log-failed > "$OUT_DIR/log-failed.txt" 2> "$OUT_DIR/log-failed.err"; then
  printf 'warning: gh run view --log-failed failed; see %s\n' "$OUT_DIR/log-failed.err" >&2
fi

if ! gh api "repos/$REPO/actions/runs/$RUN_ID/annotations" --paginate > "$OUT_DIR/annotations.json" 2> "$OUT_DIR/annotations.err"; then
  printf 'warning: annotations API failed; see %s\n' "$OUT_DIR/annotations.err" >&2
fi

if ! gh run view "$RUN_ID" --repo "$REPO" > "$OUT_DIR/run-view.txt" 2> "$OUT_DIR/run-view.err"; then
  printf 'warning: gh run view failed; see %s\n' "$OUT_DIR/run-view.err" >&2
fi

CLASSIFICATION="unknown"
CLASSIFICATION_REASON="No CI failure classifier matched. Inspect saved run/job/log/annotation files."
if grep -R -F "recent account payments have failed or your spending limit needs to be increased" "$OUT_DIR" >/dev/null 2>&1; then
  CLASSIFICATION="blocked:github_actions_billing"
  CLASSIFICATION_REASON="GitHub Actions did not start one or more jobs because account billing/payments/spending-limit state blocked runner usage. Fix GitHub Billing & plans, then rerun the workflow before diagnosing build code."
elif node - "$OUT_DIR/jobs.json" <<'NODE' >/dev/null; then
const fs = require('node:fs');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failedWithoutStartedSteps = jobs.filter((job) =>
  job.conclusion === 'failure' && !(job.steps ?? []).some((step) => step.started_at),
);
process.exit(failedWithoutStartedSteps.length > 0 ? 0 : 1);
NODE
  CLASSIFICATION="failed:pre_step_or_no_logs"
  CLASSIFICATION_REASON="At least one job failed before any step start time was recorded. This is usually runner/account/infrastructure startup failure, not a build-step failure."
fi

cat > "$OUT_DIR/classification.json" <<JSON
{
  "classification": "$CLASSIFICATION",
  "reason": "$CLASSIFICATION_REASON"
}
JSON
printf 'classification: %s\n%s\n' "$CLASSIFICATION" "$CLASSIFICATION_REASON" | tee "$OUT_DIR/classification.txt"

printf 'CI diagnostics written to %s\n' "$OUT_DIR"
