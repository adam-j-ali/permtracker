/**
 * Whether a case is on the timeline: one switch per case (`cases.showOnTimeline`), read and written by the case form,
 * the case page's menu, the timeline's case picker, the export, the import and the chat.
 *
 * A switch that was never set follows the case: on while it's open, off once it's closed, as the timeline has always
 * shown by default. Set either way, it holds whatever the case's status. Before Nov 20 2026 a second store, a list of
 * case ids in `timelinePreferences.selectedCaseIds`, was written by the menu and the picker and read beside the switch,
 * and the two disagreed; `timelineMigration.ts` turned each list into switches.
 */

export interface TimelineCase {
  showOnTimeline?: boolean;
  caseStatus: string;
}

/** What an unset switch means for this case: on while it's open. */
function followsTheCase(c: Pick<TimelineCase, "caseStatus">): boolean {
  return c.caseStatus !== "closed";
}

/** True when the case is on the timeline. */
export function onTimeline(c: TimelineCase): boolean {
  return c.showOnTimeline ?? followsTheCase(c);
}

/**
 * The switch a new case stores: off when it was asked off, and otherwise left unset so it follows the case. A new case's
 * form starts with the switch on, which is what an unset switch shows for an open case.
 */
export function timelineSwitchForNewCase(requested: boolean | undefined): false | undefined {
  return requested === false ? false : undefined;
}

/**
 * The switch after an edit, or "keep" to leave the stored one. The form shows `onTimeline(before)` and sends it back with
 * every save, so a value equal to what the timeline already shows is no change: an unset switch stays unset and keeps
 * following the case. A different value is the person's choice and is stored.
 */
export function timelineSwitchForEdit(before: TimelineCase, requested: boolean | undefined): boolean | "keep" {
  if (requested === undefined) return "keep";
  if (requested === onTimeline(before)) return "keep";
  return requested;
}

/**
 * Whether the case was on the timeline under the old two-store reader: its switch not off, and then, with a list of ids,
 * in the list; with no list, open; with an empty list (written by removing the only open case), every case.
 */
export function wasOnTimeline(c: TimelineCase & { _id: string }, selectedCaseIds: readonly string[] | undefined): boolean {
  if (c.showOnTimeline === false) return false;
  if (selectedCaseIds === undefined) return followsTheCase(c);
  if (selectedCaseIds.length === 0) return true;
  return selectedCaseIds.includes(c._id);
}

/** The switch that keeps a case where the old reader showed it, unset when following the case already does. */
export function migratedTimelineSwitch(
  c: TimelineCase & { _id: string },
  selectedCaseIds: readonly string[] | undefined,
): boolean | undefined {
  const was = wasOnTimeline(c, selectedCaseIds);
  return was === followsTheCase(c) ? undefined : was;
}

/** The switch that puts a case on the timeline or takes it off: unset when following the case already does that. */
export function timelineSwitchFor(c: Pick<TimelineCase, "caseStatus">, show: boolean): boolean | undefined {
  return show === followsTheCase(c) ? undefined : show;
}
