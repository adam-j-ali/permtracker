/**
 * Field Name Mapping Utility
 *
 * Maps camelCase DB field names to snake_case validator field names.
 * Required because:
 * - Convex schema uses camelCase (JavaScript convention)
 * - Validators use snake_case (PERM regulation convention for clarity)
 *
 * @module
 */

import type { CaseData } from '../types';
import type { GreenCardFields } from '../greenCard';
import type { CaseStatus, ProgressStatus } from '../statusTypes';
import { getFirstRecruitmentStepForPwd } from '../dates/pwdValidity';

/**
 * RFI/RFE entry structure from the database
 */
interface RfiRfeEntry {
  id: string;
  title?: string;
  description?: string;
  notes?: string;
  receivedDate: string;
  responseDueDate: string;
  responseSubmittedDate?: string;
  createdAt: number;
}

/**
 * Additional recruitment method structure
 */
interface AdditionalRecruitmentMethod {
  method: string;
  date: string;
  description?: string;
}

/**
 * Input structure matching Convex mutation args (camelCase)
 */
export interface CamelCaseFields extends Omit<GreenCardFields, 'greenCardPath' | 'ebCategory' | 'i140Category'> {
  // Past the I-140 (greenCard.ts): the I-485 or consulate dates, the card, the countries.

  // PWD dates
  pwdFilingDate?: string | null;
  pwdDeterminationDate?: string | null;
  pwdExpirationDate?: string | null;

  // Recruitment dates
  sundayAdFirstDate?: string | null;
  sundayAdSecondDate?: string | null;
  jobOrderStartDate?: string | null;
  jobOrderEndDate?: string | null;
  noticeOfFilingStartDate?: string | null;
  noticeOfFilingEndDate?: string | null;
  additionalRecruitmentStartDate?: string | null;

  // Derived recruitment dates (from derivedCalculations)
  recruitmentStartDate?: string | null;
  recruitmentEndDate?: string | null;

  // Professional occupation
  isProfessionalOccupation?: boolean;
  additionalRecruitmentMethods?: AdditionalRecruitmentMethod[];
  additionalRecruitmentEndDate?: string | null;

  // ETA 9089 dates
  eta9089FilingDate?: string | null;
  eta9089CertificationDate?: string | null;
  eta9089ExpirationDate?: string | null;
  eta9089DenialDate?: string | null;
  eta9089ReconsiderationDate?: string | null;
  eta9089ReconsiderationDeniedDate?: string | null;
  eta9089BalcaRequestDate?: string | null;

  // I-140 dates
  i140FilingDate?: string | null;
  i140ApprovalDate?: string | null;
  i140DenialDate?: string | null;

  // RFI/RFE entries (arrays)
  rfiEntries?: RfiRfeEntry[];
  rfeEntries?: RfiRfeEntry[];

  // Status
  caseStatus?: CaseStatus;
  progressStatus?: ProgressStatus;
}

/**
 * Extract the first active (non-submitted) RFI/RFE entry from an array.
 * Validators expect single-entry format for RFI/RFE fields.
 *
 * @param entries - Array of RFI or RFE entries
 * @returns The first active entry or undefined if none found
 */
function getActiveEntry(
  entries?: RfiRfeEntry[]
): RfiRfeEntry | undefined {
  if (!entries || entries.length === 0) return undefined;

  // Find first entry without a submitted date (active)
  const active = entries.find((e) => !e.responseSubmittedDate);

  // If no active entry, return the most recent one (for validation context)
  return active ?? entries[entries.length - 1];
}

/**
 * Map camelCase mutation args to snake_case validator format.
 *
 * This is the bridge between:
 * - Convex mutations (which use camelCase per JS convention)
 * - Validators (which use snake_case for PERM regulation clarity)
 *
 * @param fields - CamelCase fields from mutation args
 * @returns CaseData in snake_case format for validators
 *
 * @example
 * const validationInput = mapToValidatorFormat({
 *   pwdFilingDate: '2024-01-15',
 *   pwdDeterminationDate: '2024-03-01',
 *   ...args,
 * });
 * const result = validateCase(validationInput);
 */
export function mapToValidatorFormat(fields: CamelCaseFields): CaseData {
  // Extract active RFI/RFE entries
  const activeRfi = getActiveEntry(fields.rfiEntries);
  const activeRfe = getActiveEntry(fields.rfeEntries);

  return {
    // PWD dates (|| null so empty strings are treated as "no value")
    pwd_filing_date: fields.pwdFilingDate || null,
    pwd_determination_date: fields.pwdDeterminationDate || null,
    pwd_expiration_date: fields.pwdExpirationDate || null,

    // Recruitment dates
    sunday_ad_first_date: fields.sundayAdFirstDate || null,
    sunday_ad_second_date: fields.sundayAdSecondDate || null,
    job_order_start_date: fields.jobOrderStartDate || null,
    job_order_end_date: fields.jobOrderEndDate || null,
    notice_of_filing_start_date: fields.noticeOfFilingStartDate || null,
    notice_of_filing_end_date: fields.noticeOfFilingEndDate || null,

    // Derived recruitment dates
    recruitment_start_date: fields.recruitmentStartDate || null,
    recruitment_end_date: fields.recruitmentEndDate || null,
    pwd_recruitment_start_date: getFirstRecruitmentStepForPwd(fields) ?? null,

    // Professional occupation flag
    is_professional_occupation: fields.isProfessionalOccupation ?? false,

    // ETA 9089 dates
    eta9089_filing_date: fields.eta9089FilingDate || null,
    eta9089_certification_date: fields.eta9089CertificationDate || null,
    eta9089_expiration_date: fields.eta9089ExpirationDate || null,
    eta9089_denial_date: fields.eta9089DenialDate || null,
    eta9089_reconsideration_date: fields.eta9089ReconsiderationDate || null,
    eta9089_reconsideration_denied_date: fields.eta9089ReconsiderationDeniedDate || null,
    eta9089_balca_request_date: fields.eta9089BalcaRequestDate || null,

    // I-140 dates
    i140_filing_date: fields.i140FilingDate || null,
    i140_approval_date: fields.i140ApprovalDate || null,

    // RFI dates (from first active entry)
    rfi_received_date: activeRfi?.receivedDate || null,
    rfi_due_date: activeRfi?.responseDueDate || null,
    rfi_submitted_date: activeRfi?.responseSubmittedDate || null,

    // RFE dates (from first active entry)
    rfe_received_date: activeRfe?.receivedDate || null,
    rfe_due_date: activeRfe?.responseDueDate || null,
    rfe_submitted_date: activeRfe?.responseSubmittedDate || null,

    // Past the I-140
    i485_filing_date: fields.i485FilingDate || null,
    i485_receipt_date: fields.i485ReceiptDate || null,
    i485_biometrics_date: fields.i485BiometricsDate || null,
    i485_interview_date: fields.i485InterviewDate || null,
    i485_approval_date: fields.i485ApprovalDate || null,
    ead_filing_date: fields.eadFilingDate || null,
    ead_approval_date: fields.eadApprovalDate || null,
    ap_filing_date: fields.apFilingDate || null,
    ap_approval_date: fields.apApprovalDate || null,
    ds260_submitted_date: fields.ds260SubmittedDate || null,
    consular_interview_date: fields.consularInterviewDate || null,
    card_produced_date: fields.cardProducedDate || null,
    card_received_date: fields.cardReceivedDate || null,
    country_of_birth: fields.countryOfBirth || null,
    chargeability_country: fields.chargeabilityCountry || null,

    // Status fields with defaults
    case_status: fields.caseStatus || 'pwd',
    progress_status: fields.progressStatus || 'working',
  };
}
