/**
 * Example receipt numbers in copy can't be anyone's real case: each sits on a real office and shape, in a fiscal year
 * USCIS hasn't reached, or (online numbers) far past the running count. This file fails once a year comes within reach,
 * so the examples move before they could collide with a real receipt.
 */
import { describe, expect, it } from 'vitest';
import { decodeReceipt } from '../receipt';
import { EXAMPLE_RECEIPT, EXAMPLE_RECEIPTS, EXAMPLE_ONLINE_RECEIPT } from '../exampleReceipts';

/** The federal fiscal year a day falls in (October starts the next one). */
const fiscalYearOn = (d: Date) => d.getUTCFullYear() + (d.getUTCMonth() >= 9 ? 1 : 0);

describe('example receipt numbers', () => {
  it('decode, so the reading next to the box can show on them', () => {
    for (const r of EXAMPLE_RECEIPTS) expect(decodeReceipt(r)?.digits?.series ?? null, r).not.toBeNull();
  });

  it('sit at least five fiscal years ahead of today', () => {
    const now = fiscalYearOn(new Date());
    for (const r of EXAMPLE_RECEIPTS.filter((x) => !x.startsWith('IOE'))) {
      const d = decodeReceipt(r);
      expect(d?.digits && 'fiscalYear' in d.digits ? d.digits.fiscalYear : 0, r).toBeGreaterThanOrEqual(now + 5);
    }
  });

  it('put the online example at zero: online numbers count up from one, and real ones reach at least IOE98', () => {
    expect(EXAMPLE_ONLINE_RECEIPT).toBe('IOE0000000000');
  });

  it('lead with a service-center number', () => {
    expect(EXAMPLE_RECEIPTS[0]).toBe(EXAMPLE_RECEIPT);
  });
});
