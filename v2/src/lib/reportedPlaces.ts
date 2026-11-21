/**
 * The places people report their own cases that this site reads, said once for every page that names them, so a new
 * place reaches every sentence at once. Each sentence adds its own end ("and on this site", "and on PERM Tracker").
 * REPORTED_COMMUNITY_PLACES leaves out VisaStats' tracker, for a sentence about steps it doesn't hold (a field office)
 * or one that links it by name.
 *
 * Its own module, re-exported by reportedCases.ts, so a client component can say it without bundling the sheets list.
 */
export const REPORTED_COMMUNITY_PLACES = "Telegram and Facebook groups, community sheets, Reddit";
export const REPORTED_PLACES = `${REPORTED_COMMUNITY_PLACES}, VisaStats`;
