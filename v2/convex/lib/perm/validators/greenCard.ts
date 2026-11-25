import { isValid, parseISO } from 'date-fns';
import type { ValidationResult, ValidationIssue } from '../types';
import { createValidationResult } from '../types';
import { isCountryCode } from '../greenCard';
import { error } from '../utils/validation';

/**
 * Input for the green card checks: the dates past the I-140 and the two countries, as the validators name them.
 */
export interface GreenCardValidationInput {
  i485_filing_date?: string | null;
  i485_receipt_date?: string | null;
  i485_biometrics_date?: string | null;
  i485_interview_date?: string | null;
  i485_approval_date?: string | null;
  i485_denial_date?: string | null;
  ead_filing_date?: string | null;
  ead_approval_date?: string | null;
  ap_filing_date?: string | null;
  ap_approval_date?: string | null;
  ds260_submitted_date?: string | null;
  consular_interview_date?: string | null;
  card_produced_date?: string | null;
  card_received_date?: string | null;
  country_of_birth?: string | null;
  chargeability_country?: string | null;
}

/** An ISO day that parses, or null. */
function day(value: string | null | undefined): string | null {
  return value && isValid(parseISO(value)) ? value : null;
}

/**
 * The green card's dates and countries. Nothing here is a clock the law sets, so the checks refuse only what can't
 * happen: a step dated before the one it follows. Same-day dates pass.
 *
 * Rules:
 * - V-GC-01: The I-485's approval can't be before its filing
 * - V-GC-02: The work permit's (I-765) approval can't be before its filing
 * - V-GC-03: The travel document's (I-131) approval can't be before its filing
 * - V-GC-04: The I-485's receipt, fingerprints and interview can't be before its filing
 * - V-GC-05: The consular interview can't be before the DS-260 went in
 * - V-GC-06: The card can't arrive before it was produced
 * - V-GC-07: A country is a two-letter country code
 * - V-GC-08: The I-485's denial can't be before its filing
 */
export function validateGreenCard(input: GreenCardValidationInput): ValidationResult {
  const errors: ValidationIssue[] = [];

  const notBefore = (
    ruleId: string,
    field: string,
    later: string | null | undefined,
    earlier: string | null | undefined,
    message: string,
  ) => {
    const a = day(later);
    const b = day(earlier);
    if (a && b && a < b) errors.push(error(ruleId, field, message));
  };

  notBefore('V-GC-01', 'i485_approval_date', input.i485_approval_date, input.i485_filing_date, 'I-485 approval date cannot be before its filing date');
  notBefore('V-GC-02', 'ead_approval_date', input.ead_approval_date, input.ead_filing_date, 'Work permit approval date cannot be before its filing date');
  notBefore('V-GC-03', 'ap_approval_date', input.ap_approval_date, input.ap_filing_date, 'Travel document approval date cannot be before its filing date');
  notBefore('V-GC-04', 'i485_receipt_date', input.i485_receipt_date, input.i485_filing_date, 'I-485 receipt date cannot be before its filing date');
  notBefore('V-GC-04', 'i485_biometrics_date', input.i485_biometrics_date, input.i485_filing_date, 'I-485 fingerprints date cannot be before its filing date');
  notBefore('V-GC-04', 'i485_interview_date', input.i485_interview_date, input.i485_filing_date, 'I-485 interview date cannot be before its filing date');
  notBefore('V-GC-05', 'consular_interview_date', input.consular_interview_date, input.ds260_submitted_date, 'Consular interview date cannot be before the DS-260 was submitted');
  notBefore('V-GC-08', 'i485_denial_date', input.i485_denial_date, input.i485_filing_date, 'I-485 denial date cannot be before its filing date');
  notBefore('V-GC-06', 'card_received_date', input.card_received_date, input.card_produced_date, 'Card received date cannot be before the card was produced');

  const countries = [
    ['country_of_birth', input.country_of_birth],
    ['chargeability_country', input.chargeability_country],
  ] as const;
  for (const [field, value] of countries) {
    if (value && !isCountryCode(value)) {
      errors.push(error('V-GC-07', field, `Country must be a two-letter country code, such as IN or MX. Got: ${value}`));
    }
  }

  return createValidationResult(errors, []);
}
