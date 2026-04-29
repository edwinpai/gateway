#!/usr/bin/env bash
set -euo pipefail

INSTALL_URL="${EDWINPAI_INSTALL_URL:-${OPENCLAW_INSTALL_URL:-${CLAWDBOT_INSTALL_URL:-https://edwinpai.com/install.sh}}}"
INSTALL_SCRIPT_PATH="${EDWINPAI_INSTALL_SCRIPT_PATH:-${OPENCLAW_INSTALL_SCRIPT_PATH:-}}"
DEFAULT_PACKAGE="edwinpai"
PACKAGE_NAME="${EDWINPAI_INSTALL_PACKAGE:-${OPENCLAW_INSTALL_PACKAGE:-$DEFAULT_PACKAGE}}"
EXPECTED_CLI="${EDWINPAI_INSTALL_EXPECT_CLI:-${OPENCLAW_INSTALL_EXPECT_CLI:-$PACKAGE_NAME}}"

assert_shared_env() {
  local env_file="$HOME/.edwinpai/.env"
  local expected_shad_path="$HOME/.edwinpai/workspace"

  echo "==> Verify shared Edwin env file"
  test -f "$env_file"
  grep -q "^SHAD_COLLECTION_PATH=${expected_shad_path}$" "$env_file"

  local mode
  mode="$(stat -c '%a' "$env_file")"
  if [[ "$mode" != "600" ]]; then
    echo "ERROR: expected $env_file mode 600, got $mode" >&2
    exit 1
  fi

  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    grep -q "^OPENAI_API_KEY=${OPENAI_API_KEY}$" "$env_file"
  elif grep -q '^OPENAI_API_KEY=' "$env_file"; then
    echo "ERROR: OPENAI_API_KEY should not be persisted when not provided" >&2
    exit 1
  fi
}

echo "==> Pre-flight: ensure git absent"
if command -v git >/dev/null; then
  echo "git is present unexpectedly" >&2
  exit 1
fi

echo "==> Run installer (non-root user)"
if [[ -n "$INSTALL_SCRIPT_PATH" ]]; then
  bash "$INSTALL_SCRIPT_PATH"
else
  curl -fsSL "$INSTALL_URL" | bash
fi

assert_shared_env

# Ensure PATH picks up user npm prefix
export PATH="$HOME/.npm-global/bin:$PATH"

echo "==> Verify git installed"
command -v git >/dev/null

EXPECTED_VERSION="${EDWINPAI_INSTALL_EXPECT_VERSION:-${OPENCLAW_INSTALL_EXPECT_VERSION:-}}"
if [[ -n "$EXPECTED_VERSION" ]]; then
  LATEST_VERSION="$EXPECTED_VERSION"
elif [[ -n "$INSTALL_SCRIPT_PATH" ]]; then
  LATEST_VERSION=""
else
  LATEST_VERSION="$(npm view "$PACKAGE_NAME" version)"
fi
CLI_NAME="$EXPECTED_CLI"
CMD_PATH="$(command -v "$CLI_NAME" || true)"
if [[ -z "$CMD_PATH" && -x "$HOME/.npm-global/bin/$PACKAGE_NAME" ]]; then
  CLI_NAME="$PACKAGE_NAME"
  CMD_PATH="$HOME/.npm-global/bin/$PACKAGE_NAME"
fi
if [[ -z "$CMD_PATH" ]]; then
  echo "$PACKAGE_NAME is not on PATH" >&2
  exit 1
fi
echo "==> Verify CLI installed: $CLI_NAME"
INSTALLED_VERSION="$("$CMD_PATH" --version 2>/dev/null | head -n 1 | tr -d '\r')"

if [[ -n "$LATEST_VERSION" ]]; then
  echo "cli=$CLI_NAME installed=$INSTALLED_VERSION expected=$LATEST_VERSION"
  if [[ "$INSTALLED_VERSION" != "$LATEST_VERSION" ]]; then
    echo "ERROR: expected ${CLI_NAME}@${LATEST_VERSION}, got ${CLI_NAME}@${INSTALLED_VERSION}" >&2
    exit 1
  fi
else
  echo "cli=$CLI_NAME installed=$INSTALLED_VERSION expected=<skipped>"
fi

echo "==> Sanity: CLI runs without config warnings"
HELP_ERR="$(mktemp)"
"$CMD_PATH" --help >/dev/null 2>"$HELP_ERR"
if grep -q 'Invalid config' "$HELP_ERR"; then
  echo "ERROR: installed CLI reported an invalid generated config" >&2
  cat "$HELP_ERR" >&2
  rm -f "$HELP_ERR"
  exit 1
fi
rm -f "$HELP_ERR"

echo "OK"
