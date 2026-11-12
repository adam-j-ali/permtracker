"use client";

import { FilterableStatTable, type CsvSpec, type StatColumn } from "@/components/tools/FilterableStatTable";
import { WAIT_COLUMNS, waitBarDays, waitWords, type WaitCell } from "@/lib/visaWaits";

/** One consulate's row: its wait for each kind of visa, keyed as `WAIT_COLUMNS` keys them. */
export interface PostWaits {
  post: string;
  cells: Partial<Record<string, WaitCell>>;
}

/**
 * Every consulate's wait for each kind of visa, as a list to search, sort and page.
 *
 * WHY IT'S PAGED. State's table holds about 240 consulates. Drawn whole it was fourteen phone screens inside a
 * scrolling box of its own, and finding one post meant scrolling through the rest. A reader comes for one consulate
 * or for the longest waits, so the list opens with a box to type the city in, starts at the longest work-visa
 * wait, sorts on any column, and shows a short page.
 *
 * A PHONE SHOWS THE CONSULATE, WORK VISAS AND STUDENTS. The visitor and crew columns are in the wide table and in
 * the download: five columns of words don't fit a phone without a sideways scroll, and three do (the shared table
 * takes the screen's width when a phone shows three columns or fewer).
 */
export function VisaWaitTable({ posts }: { posts: PostWaits[] }) {
  const columns: StatColumn<PostWaits>[] = [
    {
      key: "post",
      label: "Consulate",
      sortValue: (p) => p.post,
      render: (p) => <span className="font-semibold">{p.post}</span>,
    },
    ...WAIT_COLUMNS.map((col, i): StatColumn<PostWaits> => ({
      key: col.key,
      label: col.short,
      numeric: true,
      secondary: i > 1,
      // A cell with no figure sorts last either way, never as zero days.
      sortValue: (p) => {
        const c = p.cells[col.key];
        return c ? waitBarDays(c) : null;
      },
      render: (p) => {
        const c = p.cells[col.key];
        return (
          <span className={`whitespace-nowrap tabular-nums ${c && waitBarDays(c) === null ? "text-muted-foreground" : ""}`}>
            {c ? waitWords(c) : "Not listed"}
          </span>
        );
      },
    })),
  ];
  const csv: CsvSpec<PostWaits> = {
    filename: "visa-wait-times.csv",
    header: ["consulate", ...WAIT_COLUMNS.map((c) => c.label)],
    row: (p) => [
      p.post,
      ...WAIT_COLUMNS.map((col) => {
        const c = p.cells[col.key];
        return c ? waitWords(c) : null;
      }),
    ],
  };
  return (
    <FilterableStatTable
      rows={posts}
      columns={columns}
      searchText={(p) => p.post}
      suggestText={(p) => p.post}
      searchPlaceholder="Mumbai, Manila, Ciudad Juárez…"
      // The longest wait for a work visa first: the table sorts high to low, and a name is found by typing it.
      initialSort={WAIT_COLUMNS[0].key}
      caption="The wait for a visa interview at each U.S. embassy and consulate, by visa"
      noun="consulates"
      csv={csv}
      pageSize={25}
    />
  );
}
