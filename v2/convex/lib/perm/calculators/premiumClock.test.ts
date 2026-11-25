import { describe, expect, it } from 'vitest';

import { I140_PREMIUM_BUSINESS_DAYS, premiumActionDeadline } from './premiumClock';

/**
 * The day USCIS must act on a premium I-140 by (USCIS, "How Do I Request Premium Processing?", last reviewed
 * Nov 10 2026): 15 business days for most classifications, 45 for E13 multinational executives and managers and E21
 * national interest waivers, from the day USCIS receives the I-907, or the answer to its request for evidence or
 * notice of intent to deny, which starts a new period. Expected days counted by hand on a calendar.
 */
describe('premiumActionDeadline', () => {
  it('holds the periods USCIS publishes', () => {
    expect(I140_PREMIUM_BUSINESS_DAYS).toEqual({ standard: 15, e13OrNiw: 45 });
  });

  it('counts 15 business days from the day after receipt, over Thanksgiving', () => {
    // Received Mon Nov 23 2026; Thu Nov 26 is Thanksgiving. Day 15 is Tue Dec 15.
    expect(premiumActionDeadline('2026-11-23', 'standard')).toBe('2026-12-15');
  });

  it('counts 45 for E13 and E21, over Christmas, New Year and Martin Luther King Day', () => {
    // From Nov 23 2026: Dec 25 2026 and Jan 1 2027 are Fridays, Jan 18 2027 is MLK Day. Day 45 is Fri Jan 29 2027.
    expect(premiumActionDeadline('2026-11-23', 'e13OrNiw')).toBe('2027-01-29');
  });

  it('counts from the next business day after a Friday or weekend receipt', () => {
    // Received Fri Nov 20 or Sat Nov 21 2026: day 1 is Mon Nov 23, Thanksgiving skipped, day 15 is Mon Dec 14.
    expect(premiumActionDeadline('2026-11-21', 'standard')).toBe('2026-12-14');
    expect(premiumActionDeadline('2026-11-20', 'standard')).toBe('2026-12-14');
  });

  it('refuses a day that is not a date', () => {
    expect(() => premiumActionDeadline('2026-13-40', 'standard')).toThrow();
    expect(() => premiumActionDeadline('next week', 'standard')).toThrow();
  });
});
