import Link from "next/link";

import { ScrollBox } from "@/components/ui/scroll-box";
import { bulletinMonthLabel, CATEGORY_LABEL, COUNTRY_LABEL, cutoffLabel } from "@/lib/bulletinNext";
import { getBulletinBoard } from "@/lib/db/bulletin";
import type { CountryKey } from "@/lib/perm";
import { softFail } from "@/lib/softRead";

/** The countries the bulletin prints apart, in the order articles list them. */
const COUNTRIES: readonly CountryKey[] = ["worldwide", "mexico", "philippines", "china", "india"];

/**
 * A few rows of the newest visa bulletin, for an article: one row per category, one column per country, read from the
 * archive the bulletin pages read, so the article never types a month's cutoffs that the next bulletin replaces.
 * Says so, and links the bulletin page, when the archive can't be read.
 */
export async function BulletinRowsNow({
  categories,
  chart = "finalAction",
}: {
  /** Archive codes, e.g. ["EB3", "EW3"]. */
  categories: string[];
  chart?: "finalAction" | "datesForFiling";
}) {
  const board = await getBulletinBoard().catch(softFail("BulletinRowsNow.getBulletinBoard", null));
  const cells = board ? board[chart] : [];
  const rows = categories.filter((cat) => cells.some((c) => c.category === cat));
  if (!board || rows.length === 0) {
    return (
      <p>
        The newest bulletin&apos;s dates can&apos;t be shown here for the moment.{" "}
        <Link href="/visa-bulletin" className="link">
          The visa bulletin page
        </Link>{" "}
        has them.
      </p>
    );
  }
  const chartName = chart === "finalAction" ? "Final action date" : "Date for filing";
  const month = bulletinMonthLabel(board.lastMonth);
  const cell = (cat: string, country: CountryKey) =>
    cells.find((c) => c.category === cat && c.country === country)?.latest ?? null;
  return (
    <ScrollBox label={`${chartName}s in the ${month} visa bulletin`} className="my-6 overscroll-x-none">
      <table className="w-full border border-border text-sm">
        <caption className="caption-top pb-2 text-left text-sm text-muted-foreground">
          {chartName}s in the{" "}
          <Link href="/visa-bulletin" className="link">
            {month} visa bulletin
          </Link>
          , the newest this site holds.
        </caption>
        <thead>
          <tr className="bg-muted">
            <th scope="col" className="border border-border px-4 py-2 text-left font-heading font-bold">
              Category{" "}
            </th>
            {COUNTRIES.map((country) => (
              <th key={country} scope="col" className="border border-border px-4 py-2 text-left font-heading font-bold">
                {COUNTRY_LABEL[country]}{" "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cat) => (
            <tr key={cat}>
              <th scope="row" className="border border-border px-4 py-2 text-left font-medium">
                {CATEGORY_LABEL[cat] ?? cat}{" "}
              </th>
              {COUNTRIES.map((country) => (
                <td key={country} className="border border-border px-4 py-2 font-mono tabular-nums">
                  {cutoffLabel(cell(cat, country))}{" "}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}
