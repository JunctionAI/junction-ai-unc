/** Browser-safe correlation and honest delivery wording. No provider facts inferred. */
export function artifactHeaders(accountId?: string | null, contextGeneration?: number): Record<string, string> {
  return accountId && contextGeneration !== undefined ? {
    "x-unc-account-id": accountId, "x-unc-context-generation": String(contextGeneration),
  } : {};
}

export function deliveryNotice(rows: { status: string }[], channel: string): string {
  if (!rows.length) return "No delivery receipt is available yet.";
  if (rows.every(r => r.status === "sent")) return `Accepted by ${channel}. Device delivery isn't confirmed.`;
  if (rows.some(r => r.status === "uncertain" || r.status === "sending"))
    return "Delivery is not confirmed. Check this request again; it will not be sent twice.";
  if (rows.some(r => r.status === "queued")) return "Queued — not sent yet. Checking again keeps the same request.";
  return "This request was cancelled or failed. Nothing further will be sent automatically.";
}
