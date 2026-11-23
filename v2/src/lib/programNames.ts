/**
 * The program and form names a line must never split: H-1B, H-2A, H-2B, CW-1, EB-2, I-140, I-485, ETA-9089,
 * DS-260 and the like. A browser may break a line after any hyphen, so "CW-" ended one line and "1." began the
 * next on a phone (Nov 23 2026), and no CSS property stops a break at a hard hyphen. Each name goes in a
 * no-wrap span instead: KeepWhole (src/components/ui/keep-whole.tsx) in pages, rehypeKeepProgramNames in the
 * articles, and the phone sweep's split check reads the same pattern. The pattern itself is in
 * programNames.json, so the sweep (plain Node) and the site build it from one source.
 */
import names from "./programNames.json";

/** The pattern's source, for a caller that builds its own RegExp (the phone sweep passes it into the page). */
export const PROGRAM_NAME_SOURCE: string = names.source;

/** A fresh global pattern on each call: a shared /g RegExp keeps its lastIndex from one string to the next. */
export function programNamePattern(): RegExp {
  return new RegExp(PROGRAM_NAME_SOURCE, "g");
}

export interface ProgramNameRun {
  text: string;
  /** True for a program or form name, kept on one line. */
  name: boolean;
}

/** Text as runs, each a name or the words between. Joining the runs gives back the input exactly. */
export function programNameRuns(text: string): ProgramNameRun[] {
  const runs: ProgramNameRun[] = [];
  let last = 0;
  for (const m of text.matchAll(programNamePattern())) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), name: false });
    runs.push({ text: m[0], name: true });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), name: false });
  return runs;
}
