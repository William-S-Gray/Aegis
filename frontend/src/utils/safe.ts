/**
 * Defensive coercion for values coming off the network.
 *
 * Chart libraries throw during render when handed a non-array, and a render-time
 * throw unmounts the React tree. Normalising at the boundary keeps a malformed
 * or unexpected API response from taking a page down.
 */

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asObject<T extends object>(value: unknown): Partial<T> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Extracts a human-readable message from an API failure.
 *
 * FastAPI puts the reason in `detail`, which is far more useful to an operator
 * ("That plate is already registered") than a generic failure string.
 */
export function apiMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
    ?.detail;

  if (typeof detail === 'string' && detail.trim()) return detail;

  // Pydantic validation errors arrive as a list of {loc, msg} objects.
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { msg?: string };
    if (typeof first?.msg === 'string') return first.msg;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
