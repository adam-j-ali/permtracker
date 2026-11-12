/**
 * The row and the page size the case lists share: PERM's decided and live lists, and the wage-request, LCA and
 * seasonal lists.
 *
 * ON A PHONE EACH ROW IS FOUR SHORT LINES. As a table, a phone saw the case number and half a status chip, then
 * scrolled sideways. As six stacked lines one page of a list ran thirteen screens. Below `sm` the same cells take
 * named places in a two-column grid: the employer with the status beside it, the job title on up to two lines, the case
 * number as the row's 44px target (the wage beside it when the list has one), then the dates on one line across
 * the row. CSS only, so the rows exist once and the table is unchanged from `sm` up.
 *
 * A cell takes its place with `max-sm:[grid-area:emp|status|title|form|num|wage|dates]`, and a cell a phone
 * doesn't show is `max-sm:hidden`.
 */

/** Rows on one page of a case list. A page is about four phone screens; longer lists are paged, never scrolled. */
export const LIST_PAGE_SIZE = 25;

/** The table: a block below `sm`, its header row hidden there (each cell says what it is). */
export const LIST_TABLE = "w-full border-collapse text-left text-base max-sm:block max-sm:[&_thead]:hidden";

/** Every row: a rule above it, and the two-column grid on a phone. */
export const LIST_ROW =
  "border-t-2 border-border/30 align-top max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3 max-sm:py-2.5 max-sm:[&>td]:p-0 max-sm:[&>td]:whitespace-normal";

/** The places on a phone, by name. */
export const PHONE_ROW = "max-sm:[grid-template-areas:'emp_status'_'title_title'_'num_wage'_'dates_dates']";

/** The same, with the form's short name beside the job title, for a list that shows one. */
export const PHONE_ROW_WITH_FORM = "max-sm:[grid-template-areas:'emp_status'_'title_form'_'num_wage'_'dates_dates']";

/**
 * The case number's cell: the row's tap target on a phone, 44px tall.
 * `whitespace-nowrap!`: the row lets every other cell wrap, and a case number broken at a hyphen reads as two.
 */
export const NUMBER_CELL =
  "whitespace-nowrap px-3 py-3 font-mono text-base max-sm:whitespace-nowrap! max-sm:text-sm max-sm:[grid-area:num] max-sm:[&_a]:inline-flex max-sm:[&_a]:min-h-11 max-sm:[&_a]:items-center";

/**
 * The job title's place on a phone: two lines, then cut (the whole title is on the case's page). One line hid the
 * end of a title, which is often the part that tells two of an employer's cases apart.
 */
export const TITLE_ON_PHONE = "max-sm:line-clamp-2 max-sm:text-sm max-sm:[grid-area:title]";
