/** Only same-origin absolute paths survive as a post-login destination; anything else → /app.
    Keeps /auth/callback from being an open redirect. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/app";
  return raw;
}
