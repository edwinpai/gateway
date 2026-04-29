/**
 * Strip /compact directives from agent reply text.
 *
 * Agents sometimes emit "/compact ..." as internal housekeeping (memory flush notes).
 * This should not be visible to users. We strip lines starting with /compact and
 * return the remaining text (or empty string if nothing is left).
 */
export function stripAgentCompactDirective(text: string): string {
  if (!text.includes("/compact")) {
    return text;
  }
  const lines = text.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith("/compact");
  });
  return filtered.join("\n").trim();
}
