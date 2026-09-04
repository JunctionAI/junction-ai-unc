/* Provider errors are untrusted input. Some APIs echo an invalid credential in their
   response body, so sanitise before a message can reach an LlmResult, an API response,
   or stdout. Keep this module dependency-free so the app and standalone worker share it. */

const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:sk|rk|pk)-(?:ant-)?[A-Za-z0-9_-]{6,}/gi,
  /\bAIza[A-Za-z0-9_-]{12,}/g,
  /([?&](?:api[_-]?key|key|token|secret)=)[^&\s]+/gi,
  /((?:api[_ -]?key|access[_ -]?token|secret|authorization)\s*(?::|=|provided\s*:?)\s*)["']?[^\s,"']{6,}/gi,
];

export function sanitiseProviderError(value: unknown, maxLength = 200): string {
  let out = value instanceof Error ? value.message : String(value ?? "");
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (...args: unknown[]) => {
      // replace callbacks end with offset + whole string; anything before those is a
      // capture. Only the key=value patterns deliberately preserve capture group 1.
      const captures = args.slice(1, -2);
      const prefix = typeof captures[0] === "string" ? captures[0] : "";
      return `${prefix}[redacted]`;
    });
  }
  return out.replace(/\s+/g, " ").trim().slice(0, maxLength);
}
