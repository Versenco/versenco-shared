/**
 * Builds a stable idempotency key from one or more parts (e.g. an action
 * name, a resource id, a user id). Replaces the ad-hoc string
 * concatenation (`upload_${documentId}_${userId}`) that every consuming
 * app currently writes by hand.
 */
export function idempotencyKey(...parts: string[]): string {
  if (parts.length === 0) {
    throw new Error("idempotencyKey requires at least one part");
  }
  return parts.map((p) => p.replace(/_/g, "-")).join("_");
}
