/**
 * The message to show the user for a thrown value.
 *
 * `api` rejects with an Error carrying the server's message, but a network
 * failure or a non-Error throw gives us something else — so every call site was
 * hand-writing the same `err instanceof Error ? err.message : '…'` ternary.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}
