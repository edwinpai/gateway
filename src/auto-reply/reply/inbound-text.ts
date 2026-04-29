export function normalizeInboundTextNewlines(input: string): string {
  return input.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\\n", "\n");
}

/**
 * SECURITY: Sanitize inbound chat messages by rejecting null bytes and
 * stripping unsafe control characters before dispatch. Normalizes Unicode
 * to NFC for consistent processing.
 */
export function sanitizeInboundText(input: string): string {
  // Reject null bytes entirely — these have no legitimate use in chat text
  if (input.includes("\0")) {
    throw new Error("Invalid message: contains null bytes");
  }
  // Strip C0/C1 control characters except tab (\x09), newline (\x0a), and
  // carriage return (\x0d, handled by newline normalization).
  // oxlint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
  // Normalize Unicode to NFC for consistent handling
  return stripped.normalize("NFC");
}
