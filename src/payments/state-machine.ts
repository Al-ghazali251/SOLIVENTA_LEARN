export const paymentStates = [
  'initialized',
  'pending',
  'successful',
  'failed',
  'cancelled',
  'refunded',
] as const;
export type PaymentState = (typeof paymentStates)[number];

const transitions: Readonly<Record<PaymentState, readonly PaymentState[]>> = {
  initialized: ['pending', 'failed', 'cancelled'],
  pending: ['successful', 'failed', 'cancelled'],
  successful: ['refunded'],
  failed: [],
  cancelled: [],
  refunded: [],
};

export function transitionPayment(current: PaymentState, next: PaymentState): PaymentState {
  if (current === next) return current;
  if (!transitions[current].includes(next))
    throw new Error(`Payment cannot transition from ${current} to ${next}.`);
  return next;
}

export function shouldApplyProviderEvent(
  processedEventIds: ReadonlySet<string>,
  eventId: string,
): boolean {
  if (!eventId.trim()) throw new Error('Provider event ID is required.');
  return !processedEventIds.has(eventId);
}
