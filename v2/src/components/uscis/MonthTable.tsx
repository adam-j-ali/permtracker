"use client";

import { useState } from "react";

import { ChoiceRow } from "@/components/ui/choice-row";
import { choiceVariants } from "@/components/ui/choice";
import { keepWhole } from "@/components/ui/keep-whole";
import { Pager } from "@/components/ui/pager";
import { ScrollBox } from "@/components/ui/scroll-box";

export interface MonthLine {
  month: string;
  counted: number;
  approvedCount: number;
  approved: number;
  low: number;
  high: number;
  rfe: number;
  waiting: number;
  walked: boolean;
}

const PER_PAGE = 12;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const int = (n: number) => n.toLocaleString("en-US");
const label = (m: string) =>
  new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * The sample's shares by the month a case was filed, one form at a time, a year to a page. Each share comes with its
 * 95% margin and the cases behind it.
 */
export function MonthTable({ series }: { series: { form: string; rows: MonthLine[] }[] }) {
  const [form, setForm] = useState(series[0]?.form ?? "");
  const [page, setPage] = useState(1);
  const s = series.find((x) => x.form === form) ?? series[0];
  if (!s) return null;
  const pages = Math.max(1, Math.ceil(s.rows.length / PER_PAGE));
  const at = Math.min(page, pages);
  const shown = s.rows.slice((at - 1) * PER_PAGE, at * PER_PAGE);
  return (
    <div>
      <ChoiceRow
        label="Form"
        options={series.map((x) => ({ value: x.form, label: x.form }))}
        value={s.form}
        onChange={(v) => {
          setForm(v);
          setPage(1);
        }}
      />{" "}
      <ScrollBox className="mt-4" label={`${s.form} cases by the month they were filed`}>
        <table className="w-full min-w-[620px] border-2 border-border text-left text-base">
          <thead className="bg-tint">
            <tr>
              <th scope="col" className="px-4 py-2">Filed in</th>
              <th scope="col" className="px-4 py-2 text-right">Sampled</th>
              <th scope="col" className="px-4 py-2 text-right">Approved</th>
              <th scope="col" className="px-4 py-2">Margin</th>
              <th scope="col" className="px-4 py-2 text-right">Evidence request</th>
              <th scope="col" className="px-4 py-2 text-right">Still waiting</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.month} className="border-t-2 border-border">
                <th scope="row" className="px-4 py-2 font-bold">{label(r.month)}</th>
                <td className="px-4 py-2 text-right tabular-nums">{int(r.counted)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.approved)}</td>
                <td className="px-4 py-2 tabular-nums text-muted-foreground">
                  {pct(r.low)} to {pct(r.high)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.rfe)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{pct(r.waiting)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>{" "}
      {pages > 1 ? (
        <Pager
          className="mt-3"
          page={at}
          hasPrevious={at > 1}
          hasNext={at < pages}
          onPrevious={() => setPage(at - 1)}
          onNext={() => setPage(at + 1)}
          noun="page"
          id="month-pages"
          buttonClassName={choiceVariants()}
        >
          <p className="text-sm text-muted-foreground">{`${pages} pages, a year to a page`}</p>
        </Pager>
      ) : null}{" "}
      <p className="mt-3 text-sm text-muted-foreground">
        {keepWhole(`${s.form}: `)}
        {int(s.rows.reduce((n, r) => n + r.counted, 0))} sampled cases across {s.rows.length} months.
      </p>
    </div>
  );
}
