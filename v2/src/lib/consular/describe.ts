/**
 * A consulate page's search description (/consular-posts/<post>): what the page holds, led by the post's name.
 * The full sentence ran to 161 characters for Ho Chi Minh City (Ahrefs, Nov 21 2026), so a long name takes the
 * shorter forms; every form names the same three things the page shows.
 */

import { firstThatFits } from "@/lib/describe";

export function consularDescription(name: string): string {
  return firstThatFits([
    `Where the US consulate in ${name} stands: the month NVC is scheduling for interviews, the immigrant visas it issued each month, and the interview pause.`,
    `Where the US consulate in ${name} stands: the month NVC is scheduling, the immigrant visas it issued each month, and the interview pause.`,
    `The US consulate in ${name}: the month NVC is scheduling, the immigrant visas it issued each month, and the interview pause.`,
  ]);
}
