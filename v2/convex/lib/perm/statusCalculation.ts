/**
 * Auto-Status Calculation
 *
 * SINGLE SOURCE OF TRUTH for calculating case/progress status from dates.
 *
 * This function determines the correct caseStatus and progressStatus based on
 * which milestone dates have been entered. It checks stages in reverse order
 * (I-140 → ETA 9089 → Recruitment → PWD) and returns the appropriate status.
 *
 * Used by:
 * - Backend mutations (cases.create, cases.update) to auto-calculate status
 * - Frontend form hook (useFormCalculations) for status suggestions
 *
 * @module
 */

import type { CaseStatus, ProgressStatus } from './statusTypes';
import { isRecruitmentComplete } from './recruitment/isRecruitmentComplete';
import { FILING_WINDOW_WAIT_DAYS } from './constants';
import { getLastRecruitmentDate } from './dates/filingWindow';
import { denialReviewStep } from './calculators/denialReview';
import { greenCardPathOf, hasGreenCardDates, type GreenCardFields } from './greenCard';
import { parseISO, addDays, isAfter } from 'date-fns';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for status calculation.
 * Supports both camelCase (frontend) and snake_case (backend validators).
 */
export interface StatusCalculationInput extends GreenCardFields {
  // Past the I-140 (lib/perm/greenCard.ts): the path, the I-485 or consulate dates, the card.

  // RFI/RFE entries (for active status detection)
  rfiEntries?: Array<{ receivedDate?: string; responseSubmittedDate?: string }>;
  rfeEntries?: Array<{ receivedDate?: string; responseSubmittedDate?: string }>;

  // I-140 dates
  i140ApprovalDate?: string | null;
  i140DenialDate?: string | null;
  i140FilingDate?: string | null;

  // ETA 9089 dates
  eta9089CertificationDate?: string | null;
  eta9089FilingDate?: string | null;
  // ETA 9089 denial and what was asked after it (calculators/denialReview.ts)
  eta9089DenialDate?: string | null;
  eta9089ReconsiderationDate?: string | null;
  eta9089ReconsiderationDeniedDate?: string | null;
  eta9089BalcaRequestDate?: string | null;

  // PWD dates
  pwdDeterminationDate?: string | null;
  pwdFilingDate?: string | null;

  // Recruitment dates (for isRecruitmentComplete check)
  jobOrderStartDate?: string | null;
  jobOrderEndDate?: string | null;
  sundayAdFirstDate?: string | null;
  sundayAdSecondDate?: string | null;
  noticeOfFilingStartDate?: string | null;
  noticeOfFilingEndDate?: string | null;

  // Professional occupation
  isProfessionalOccupation?: boolean;
  additionalRecruitmentMethods?: Array<{ method: string; date: string; description?: string }>;
  additionalRecruitmentEndDate?: string | null;
}

/**
 * Result of status calculation
 */
export interface AutoStatusResult {
  caseStatus: CaseStatus;
  progressStatus: ProgressStatus;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if any entry in the array is active (received but not responded)
 */
function hasActiveEntry(
  entries: Array<{ receivedDate?: string; responseSubmittedDate?: string }> | undefined
): boolean {
  return entries?.some((e) => e.receivedDate && !e.responseSubmittedDate) ?? false;
}

/**
 * Get the last recruitment end date for quiet period calculation.
 * Delegates to canonical getLastRecruitmentDate which excludes the latest
 * additional method per 20 CFR 656.17(e)(1)(ii).
 */
function getRecruitmentEndDate(input: StatusCalculationInput): string | null {
  return getLastRecruitmentDate(
    {
      sundayAdSecondDate: input.sundayAdSecondDate || undefined,
      jobOrderEndDate: input.jobOrderEndDate || undefined,
      noticeOfFilingEndDate: input.noticeOfFilingEndDate || undefined,
      additionalRecruitmentEndDate: input.additionalRecruitmentEndDate || undefined,
      additionalRecruitmentMethods: input.additionalRecruitmentMethods,
    },
    input.isProfessionalOccupation || false
  ) || null;
}

/**
 * Check if the ETA 9089 filing window is open
 * (30+ days have passed since the last recruitment step)
 */
function isEta9089WindowOpen(input: StatusCalculationInput): boolean {
  if (!isRecruitmentComplete(input)) return false;

  const recruitmentEnd = getRecruitmentEndDate(input);
  if (!recruitmentEnd) return false;

  const endDate = parseISO(recruitmentEnd);
  const windowOpenDate = addDays(endDate, FILING_WINDOW_WAIT_DAYS);
  const today = new Date();

  return !isAfter(windowOpenDate, today);
}

/**
 * The stage past the I-140, or null when the case hasn't reached one: complete once the card arrived, otherwise the
 * I-485 or consulate step its dates reach. A path chosen with no date yet starts that path only once the I-140 is
 * approved, the way a certification starts the I-140. Reopening a case reads it too (caseListHelpers.ts).
 */
export function calculateGreenCardStatus(input: StatusCalculationInput): AutoStatusResult | null {
  if (input.cardReceivedDate) return { caseStatus: 'complete', progressStatus: 'approved' };
  return greenCardStage(input);
}

function greenCardStage(input: StatusCalculationInput): AutoStatusResult | null {
  const path = greenCardPathOf(input);
  if (!hasGreenCardDates(input)) {
    if (path && input.i140ApprovalDate) {
      return { caseStatus: path === 'consular' ? 'consular' : 'i485', progressStatus: 'working' };
    }
    return null;
  }
  // A card date alone names no path: the I-485 is the usual one for a case that began as a PERM in the US.
  const caseStatus = path === 'consular' ? 'consular' : 'i485';
  if (input.cardProducedDate) return { caseStatus, progressStatus: 'approved' };
  if (caseStatus === 'consular') {
    if (input.consularInterviewDate) return { caseStatus, progressStatus: 'under_review' };
    if (input.ds260SubmittedDate) return { caseStatus, progressStatus: 'filed' };
    return { caseStatus, progressStatus: 'working' };
  }
  if (input.i485ApprovalDate) return { caseStatus, progressStatus: 'approved' };
  // Denied: the I-140 usually stands, so the case stays here, back to working on a motion, a new filing or the
  // consulate. Closing it is the person's call, as with a final ETA 9089 denial.
  if (input.i485DenialDate) return { caseStatus, progressStatus: 'working' };
  if (input.i485InterviewDate) return { caseStatus, progressStatus: 'under_review' };
  if (input.i485FilingDate || input.i485ReceiptDate || input.eadFilingDate || input.apFilingDate) {
    return { caseStatus, progressStatus: 'filed' };
  }
  return { caseStatus, progressStatus: 'working' };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Calculate the appropriate case and progress status based on current data.
 *
 * Checks stages in reverse order (card → I-485 or consulate → I-140 → ETA 9089 → Recruitment → PWD).
 * This ensures the status reflects the most advanced stage of the case.
 *
 * Priority order:
 * 0. The green card received: complete
 * 1. Active RFI/RFE (overrides stage-based status)
 * 2. I-140 denied (closes the case, whatever was filed beside it)
 * 3. I-485 or consulate stage (card produced > approved > denied, back to working > interview > filed > working)
 * 4. I-140 stage (approved > filed)
 * 5. ETA 9089 stage (certified > denied > filed)
 * 6. Recruitment stage (complete + window open > complete > in progress)
 * 7. PWD stage (filed > working)
 *
 * @example
 * // Case with only PWD determination date
 * calculateAutoStatus({ pwdDeterminationDate: '2024-06-15' })
 * // => { caseStatus: 'recruitment', progressStatus: 'working' }
 *
 * @example
 * // Case with PWD filed but not determined
 * calculateAutoStatus({ pwdFilingDate: '2024-01-15' })
 * // => { caseStatus: 'pwd', progressStatus: 'filed' }
 */
export function calculateAutoStatus(input: StatusCalculationInput): AutoStatusResult {
  // -------------------------------------------------------------------------
  // 0. The green card arrived: the case is complete, whatever was left open
  // -------------------------------------------------------------------------
  if (input.cardReceivedDate) {
    return { caseStatus: 'complete', progressStatus: 'approved' };
  }

  // -------------------------------------------------------------------------
  // 1. RFI/RFE override
  // -------------------------------------------------------------------------
  if (hasActiveEntry(input.rfeEntries)) {
    return { caseStatus: 'i140', progressStatus: 'rfi_rfe' };
  }
  if (hasActiveEntry(input.rfiEntries)) {
    return { caseStatus: 'eta9089', progressStatus: 'rfi_rfe' };
  }

  // -------------------------------------------------------------------------
  // 2. I-140 denied (an approval on the case wins, as it always did)
  // -------------------------------------------------------------------------
  if (input.i140DenialDate && !input.i140ApprovalDate) {
    // progressStatus 'approved' here means the ETA 9089 was approved/certified
    // before the I-140 was denied — the case closes but retains the last progress milestone
    return { caseStatus: 'closed', progressStatus: 'approved' };
  }

  // -------------------------------------------------------------------------
  // 3. Past the I-140: the I-485 or the consulate
  // -------------------------------------------------------------------------
  const greenCard = greenCardStage(input);
  if (greenCard) return greenCard;

  // -------------------------------------------------------------------------
  // 4. I-140 stage checks
  // -------------------------------------------------------------------------
  if (input.i140ApprovalDate) {
    return { caseStatus: 'i140', progressStatus: 'approved' };
  }
  if (input.i140FilingDate) {
    return { caseStatus: 'i140', progressStatus: 'filed' };
  }

  // -------------------------------------------------------------------------
  // 5. ETA 9089 stage checks
  // -------------------------------------------------------------------------
  if (input.eta9089CertificationDate) {
    return { caseStatus: 'i140', progressStatus: 'working' };
  }
  // Denied: the case stays in the ETA 9089 stage while reconsideration or BALCA
  // review can still be asked for or is pending. A denial that's final is closed
  // by the user (or the stage set by hand), never here: the dates can't tell a
  // missed deadline from a request not yet recorded.
  const denial = denialReviewStep(input);
  if (denial === 'reconsidering' || denial === 'at-balca') {
    return { caseStatus: 'eta9089', progressStatus: 'under_review' };
  }
  if (denial) {
    return { caseStatus: 'eta9089', progressStatus: 'working' };
  }
  if (input.eta9089FilingDate) {
    return { caseStatus: 'eta9089', progressStatus: 'filed' };
  }

  // -------------------------------------------------------------------------
  // 6. Recruitment stage checks
  // -------------------------------------------------------------------------
  if (input.pwdDeterminationDate) {
    const recruitmentDone = isRecruitmentComplete(input);
    if (recruitmentDone) {
      const windowOpen = isEta9089WindowOpen(input);
      return windowOpen
        ? { caseStatus: 'eta9089', progressStatus: 'working' }
        : { caseStatus: 'recruitment', progressStatus: 'filed' };
    }
    // PWD determined but recruitment not complete = recruitment in progress
    return { caseStatus: 'recruitment', progressStatus: 'working' };
  }

  // -------------------------------------------------------------------------
  // 7. PWD stage checks
  // -------------------------------------------------------------------------
  if (input.pwdFilingDate) {
    return { caseStatus: 'pwd', progressStatus: 'filed' };
  }

  // -------------------------------------------------------------------------
  // Default: PWD stage, working (new case)
  // -------------------------------------------------------------------------
  return { caseStatus: 'pwd', progressStatus: 'working' };
}
