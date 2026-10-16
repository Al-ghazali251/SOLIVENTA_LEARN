export type FeeBalance = Readonly<{
  invoicedMinor: number;
  paidMinor: number;
  creditedMinor: number;
  outstandingMinor: number;
  status: 'unpaid' | 'partial' | 'paid' | 'credit';
}>;

function assertMinorUnits(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Currency amounts must be non-negative integer minor units.');
}

export function calculateFeeBalance(
  invoicedMinor: number,
  paymentsMinor: readonly number[],
): FeeBalance {
  assertMinorUnits(invoicedMinor);
  paymentsMinor.forEach(assertMinorUnits);
  const paidMinor = paymentsMinor.reduce((total, payment) => total + payment, 0);
  if (!Number.isSafeInteger(paidMinor)) throw new Error('Payment total exceeds the safe range.');
  const outstandingMinor = Math.max(0, invoicedMinor - paidMinor);
  const creditedMinor = Math.max(0, paidMinor - invoicedMinor);
  const status =
    creditedMinor > 0
      ? 'credit'
      : outstandingMinor === 0
        ? 'paid'
        : paidMinor === 0
          ? 'unpaid'
          : 'partial';
  return { invoicedMinor, paidMinor, creditedMinor, outstandingMinor, status };
}
