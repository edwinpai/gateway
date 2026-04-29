#!/bin/bash
# dreamer.sh — Memory consolidation via direct LLM call
# Gathers recent episodic memories, sends a single synthesis prompt, writes results
set -euo pipefail

WORKSPACE="$HOME/.edwinpai/workspace"
MEMORY_DIR="$WORKSPACE/memory"
LOG_FILE="$MEMORY_DIR/consolidation-log.md"

# Load env for API keys
set -a
[ -f "$HOME/.edwinpai/.env" ] && source "$HOME/.edwinpai/.env"
set +a

# OAuth tokens (sk-ant-oat*) work fine for API calls — keep them

echo "[$(date -Iseconds)] Dreamer starting..."

# 1. Gather recent daily notes (last 14 days)
CUTOFF=$(date -d "14 days ago" +%Y-%m-%d)
DAILY_NOTES=""
for f in "$MEMORY_DIR"/2026-*.md; do
  [ -f "$f" ] || continue
  basename=$(basename "$f" .md)
  if [[ "$basename" > "$CUTOFF" ]] || [[ "$basename" == "$CUTOFF" ]]; then
    DAILY_NOTES+="=== $basename ===
$(cat "$f")

"
  fi
done

if [ -z "$DAILY_NOTES" ]; then
  echo "[$(date -Iseconds)] No recent daily notes found. Nothing to consolidate."
  exit 0
fi

# 2. Gather existing semantic files for context
SEMANTIC_CONTEXT=""
for f in "$MEMORY_DIR"/peers/*/profile.md "$MEMORY_DIR"/contacts.md "$MEMORY_DIR"/capabilities.md; do
  [ -f "$f" ] || continue
  relpath="${f#$WORKSPACE/}"
  SEMANTIC_CONTEXT+="=== $relpath ===
$(cat "$f")

"
done

# 3. Check existing consolidation log
EXISTING_LOG=""
if [ -f "$LOG_FILE" ]; then
  EXISTING_LOG=$(tail -50 "$LOG_FILE")
fi

# 4. Build the prompt
PROMPT="You are a memory consolidation agent. Review the EPISODIC MEMORIES below and extract durable knowledge that should be preserved as semantic memory.

## EXISTING SEMANTIC FILES (for context — update these if you find new info)
$SEMANTIC_CONTEXT

## RECENT CONSOLIDATION LOG (avoid re-consolidating)
$EXISTING_LOG

## EPISODIC MEMORIES (daily notes from last 14 days)
$DAILY_NOTES

## TASK
Analyze the episodic memories and output a JSON array of file operations:

\`\`\`json
[
  {
    \"action\": \"update\",
    \"file\": \"memory/peers/jake/profile.md\",
    \"content\": \"full updated file content...\"
  },
  {
    \"action\": \"create\",
    \"file\": \"memory/some-topic.md\",
    \"content\": \"full file content...\"
  }
]
\`\`\`

## RULES
- Each file must be SELF-CONTAINED (readable with zero prior context)
- Include WHO, WHAT, WHEN (date range), WHY
- Update existing files rather than creating duplicates
- Do NOT consolidate one-off events, private peer info into shared files, or ephemeral state
- Do NOT reproduce daily notes — extract PATTERNS and DURABLE FACTS only
- Output ONLY the JSON array, no other text
- If nothing worth consolidating, output: []"

# 5. Call OpenAI API (we have a valid key, Anthropic OAuth doesn't work with curl)
echo "[$(date -Iseconds)] Calling GPT-4 for synthesis..."
RESPONSE=$(curl -s --max-time 120 https://api.openai.com/v1/chat/completions \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d "$(jq -n \
    --arg prompt "$PROMPT" \
    '{
      model: "gpt-4o",
      max_tokens: 8192,
      messages: [{role: "user", content: $prompt}]
    }')")

# 6. Extract the text content (OpenAI format)
TEXT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty')

if [ -z "$TEXT" ]; then
  echo "[$(date -Iseconds)] ERROR: No response from Claude"
  echo "$RESPONSE" | head -5
  exit 1
fi

# 7. Extract JSON from response (handle markdown code blocks)
JSON=$(echo "$TEXT" | sed -n '/^\[/,/^\]/p')
if [ -z "$JSON" ]; then
  # Try extracting from code block
  JSON=$(echo "$TEXT" | sed -n '/```json/,/```/p' | sed '1d;$d')
fi
if [ -z "$JSON" ]; then
  JSON="$TEXT"
fi

# 8. Process file operations
COUNT=$(echo "$JSON" | jq 'length' 2>/dev/null || echo 0)

if [ "$COUNT" -eq 0 ] || [ "$JSON" = "[]" ]; then
  echo "[$(date -Iseconds)] Nothing to consolidate."
  echo "## $(date +%Y-%m-%d)" >> "$LOG_FILE"
  echo "- No new patterns found to consolidate" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"
  exit 0
fi

echo "[$(date -Iseconds)] Processing $COUNT file operations..."

CONSOLIDATED_FILES=""
for i in $(seq 0 $((COUNT - 1))); do
  ACTION=$(echo "$JSON" | jq -r ".[$i].action")
  FILE=$(echo "$JSON" | jq -r ".[$i].file")
  CONTENT=$(echo "$JSON" | jq -r ".[$i].content")

  FULL_PATH="$WORKSPACE/$FILE"
  mkdir -p "$(dirname "$FULL_PATH")"

  echo "[$(date -Iseconds)] $ACTION: $FILE"
  echo "$CONTENT" > "$FULL_PATH"
  CONSOLIDATED_FILES+="  - [$ACTION] $FILE
"
done

# 9. Write consolidation log
echo "## $(date +%Y-%m-%d)" >> "$LOG_FILE"
echo "- Consolidated $COUNT files:" >> "$LOG_FILE"
echo "$CONSOLIDATED_FILES" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

echo "[$(date -Iseconds)] Dreamer complete. $COUNT files written."
