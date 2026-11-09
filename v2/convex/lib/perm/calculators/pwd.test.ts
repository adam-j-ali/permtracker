import { describe, it, expect } from 'vitest';
import { calculatePWDExpiration, pwdExpirationOnRecord } from './pwd';

describe('calculatePWDExpiration', () => {
  describe('Case 1: April 2 - June 30 (determination + 90 days)', () => {
    it('should calculate May 15 → Aug 13', () => {
      expect(calculatePWDExpiration('2024-05-15')).toBe('2024-08-13');
    });

    it('should calculate Apr 2 → Jul 1', () => {
      expect(calculatePWDExpiration('2024-04-02')).toBe('2024-07-01');
    });

    it('should calculate Jun 30 → Sep 28', () => {
      expect(calculatePWDExpiration('2024-06-30')).toBe('2024-09-28');
    });

    it('should handle edge case at April 2 boundary', () => {
      expect(calculatePWDExpiration('2024-04-02')).toBe('2024-07-01');
    });

    it('should handle edge case at June 30 boundary', () => {
      expect(calculatePWDExpiration('2024-06-30')).toBe('2024-09-28');
    });
  });

  describe('Case 2: July 1 - December 31 (June 30 of following year)', () => {
    it('should calculate Sep 10, 2024 → Jun 30, 2025', () => {
      expect(calculatePWDExpiration('2024-09-10')).toBe('2025-06-30');
    });

    it('should calculate Jul 1, 2024 → Jun 30, 2025', () => {
      expect(calculatePWDExpiration('2024-07-01')).toBe('2025-06-30');
    });

    it('should calculate Dec 31, 2024 → Jun 30, 2025', () => {
      expect(calculatePWDExpiration('2024-12-31')).toBe('2025-06-30');
    });

    it('should handle edge case at July 1 boundary', () => {
      expect(calculatePWDExpiration('2024-07-01')).toBe('2025-06-30');
    });

    it('should handle edge case at December 31 boundary', () => {
      expect(calculatePWDExpiration('2024-12-31')).toBe('2025-06-30');
    });
  });

  describe('Case 3: January 1 - April 1 (June 30 of same year)', () => {
    it('should calculate Feb 5, 2024 → Jun 30, 2024', () => {
      expect(calculatePWDExpiration('2024-02-05')).toBe('2024-06-30');
    });

    it('should calculate Apr 1, 2024 → Jun 30, 2024', () => {
      expect(calculatePWDExpiration('2024-04-01')).toBe('2024-06-30');
    });

    it('should calculate Jan 1, 2024 → Jun 30, 2024', () => {
      expect(calculatePWDExpiration('2024-01-01')).toBe('2024-06-30');
    });

    it('should handle edge case at January 1 boundary', () => {
      expect(calculatePWDExpiration('2024-01-01')).toBe('2024-06-30');
    });

    it('should handle edge case at April 1 boundary', () => {
      expect(calculatePWDExpiration('2024-04-01')).toBe('2024-06-30');
    });
  });

  describe('Leap year handling', () => {
    it('should handle leap year dates correctly (Feb 29, 2024)', () => {
      expect(calculatePWDExpiration('2024-02-29')).toBe('2024-06-30');
    });

    it('should handle leap year with 90-day calculation (May 15, 2024)', () => {
      expect(calculatePWDExpiration('2024-05-15')).toBe('2024-08-13');
    });
  });

  describe('Year transitions', () => {
    it('should handle year transition for Case 2 (Dec 15, 2023 → Jun 30, 2024)', () => {
      expect(calculatePWDExpiration('2023-12-15')).toBe('2024-06-30');
    });

    it('should handle year transition for Case 3 (Jan 15, 2025 → Jun 30, 2025)', () => {
      expect(calculatePWDExpiration('2025-01-15')).toBe('2025-06-30');
    });
  });
});

describe('pwdExpirationOnRecord', () => {
  it('is the rule\'s day when DOL\'s file lists the day before it, as the file does', () => {
    // June 30 determinations: the file lists June 29.
    expect(pwdExpirationOnRecord('2024-09-10', '2025-06-29')).toEqual({ date: '2025-06-30', asListed: false });
    // Determination + 90 days: the file lists + 89 (determined 2023-04-14, typed 2023-07-13, listed 2023-07-12).
    expect(pwdExpirationOnRecord('2023-04-14', '2023-07-12')).toEqual({ date: '2023-07-13', asListed: false });
  });

  it('is the rule\'s day when the file lists that day, or lists nothing', () => {
    expect(pwdExpirationOnRecord('2024-09-10', '2025-06-30')).toEqual({ date: '2025-06-30', asListed: false });
    expect(pwdExpirationOnRecord('2024-09-10', null)).toEqual({ date: '2025-06-30', asListed: false });
    expect(pwdExpirationOnRecord('2024-09-10', undefined)).toEqual({ date: '2025-06-30', asListed: false });
    expect(pwdExpirationOnRecord('2024-09-10', '')).toEqual({ date: '2025-06-30', asListed: false });
  });

  it('keeps any other date DOL lists, and says it is the file\'s', () => {
    expect(pwdExpirationOnRecord('2024-09-10', '2025-07-15')).toEqual({ date: '2025-07-15', asListed: true });
    // Two days early isn't the file's known habit, so it isn't explained away.
    expect(pwdExpirationOnRecord('2024-09-10', '2025-06-28')).toEqual({ date: '2025-06-28', asListed: true });
  });

  it('steps back across a month and a year boundary to find the day before', () => {
    // Determined April 2, 2024: + 90 days is July 1, and the file's day before is June 30.
    expect(pwdExpirationOnRecord('2024-04-02', '2024-06-30')).toEqual({ date: '2024-07-01', asListed: false });
  });
});
