/** Plain words for API codes, shared by every screen that shows them. */

/** Why an alert fired. The colour scheme is what a guard reads first. */
export const MISMATCH: Record<string, { label: string; scheme: string }> = {
  none: { label: 'Matches register', scheme: 'green' },
  visitor: { label: 'Expected visitor', scheme: 'blue' },
  type: { label: 'Vehicle type mismatch', scheme: 'orange' },
  color: { label: 'Colour mismatch', scheme: 'orange' },
  unregistered: { label: 'Unregistered plate', scheme: 'red' },
  watchlist: { label: 'WATCHLIST', scheme: 'red' },
};

export const mismatchLabel = (code: string): string => MISMATCH[code]?.label ?? code;
export const mismatchScheme = (code: string): string => MISMATCH[code]?.scheme ?? 'gray';

/** A recorded gate decision (AccessAction). */
export const DECISION: Record<string, { label: string; scheme: string }> = {
  approve: { label: 'Let in', scheme: 'green' },
  deny: { label: 'Turned away', scheme: 'red' },
  override: { label: 'Manual decision', scheme: 'orange' },
  entry: { label: 'Entered', scheme: 'green' },
  exit: { label: 'Left', scheme: 'gray' },
};

export const decisionLabel = (code: string): string => DECISION[code]?.label ?? code;
export const decisionScheme = (code: string): string => DECISION[code]?.scheme ?? 'gray';
