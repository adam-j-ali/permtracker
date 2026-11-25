"use client";

import { useState } from "react";

import { ChartHit } from "@/components/data/ChartHit";
import { ChartTips } from "@/components/data/ChartTips";
import { ChoiceRow } from "@/components/ui/choice-row";

/** One block on the chart: its sampled cases of the form and the approved share with its 95% margin. */
export interface BlockPoint {
  block: string;
  counted: number;
  count: number;
  share: number;
  low: number;
  high: number;
}

export interface FormSeries {
  form: string;
  points: BlockPoint[];
  /** The last block with an approval in the sample, or null. */
  stopAfter: string | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The approved share of each receipt block, one form at a time: a dot per block with its margin drawn as a line, and a
 * mark after the last block where the sample saw an approval. `highlight` rings one block (the block page's own).
 */
export function BlockApprovalChart({ series, highlight }: { series: FormSeries[]; highlight?: string }) {
  const [form, setForm] = useState(series[0]?.form ?? "");
  const s = series.find((x) => x.form === form) ?? series[0];
  if (!s) return null;
  const pts = s.points;
  const step = 10;
  const L = 48, R = 12, T = 12, B = 44, H = 300;
  const W = Math.max(640, L + R + pts.length * step);
  const plotH = H - T - B;
  const y = (v: number) => T + (1 - v) * plotH;
  const x = (i: number) => L + i * step + step / 2;
  const stopAt = s.stopAfter ? pts.findIndex((p) => p.block === s.stopAfter) : -1;
  const label = `${s.form}: share approved in each receipt block`;
  const every = Math.max(1, Math.ceil(pts.length / 8));
  return (
    <div>
      {series.length > 1 ? (
        <ChoiceRow
          label="Form"
          options={series.map((x) => ({ value: x.form, label: x.form }))}
          value={s.form}
          onChange={setForm}
        />
      ) : null}{" "}
      <ChartTips label={label} scroll="" className="mt-4">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W }} className="w-full" role="group" aria-label={label}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-chart-sage" strokeWidth={1} />
              <text x={L - 8} y={y(t) + 5} textAnchor="end" className="fill-muted-foreground font-mono" fontSize={14}>
                {pct(t)}
              </text>
            </g>
          ))}
          {stopAt >= 0 && stopAt < pts.length - 1 ? (
            <g>
              <line
                x1={x(stopAt) + step / 2}
                x2={x(stopAt) + step / 2}
                y1={T}
                y2={H - B}
                className="stroke-data-warn-ink"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
              <text x={x(stopAt) + step / 2 + 6} y={T + 14} className="fill-data-warn-ink font-mono" fontSize={14}>
                no approvals seen after this
              </text>
            </g>
          ) : null}
          {pts.map((p, i) =>
            i % every === 0 ? (
              <text key={`l-${p.block}`} x={x(i)} y={H - 16} textAnchor="middle" className="fill-muted-foreground font-mono" fontSize={14}>
                {p.block.slice(3)}
              </text>
            ) : null,
          )}
          {pts.map((p, i) => {
            const tip = [
              `Block ${p.block}`,
              `${p.count} of ${p.counted} sampled ${s.form} cases approved (${pct(p.share)})`,
              `95% margin: ${pct(p.low)} to ${pct(p.high)}`,
            ].join("\n");
            const mine = p.block === highlight;
            return (
              <ChartHit key={p.block} tip={tip} x={L + i * step} width={step} y={T} height={plotH}>
                <line x1={x(i)} x2={x(i)} y1={y(p.high)} y2={y(p.low)} className="stroke-foreground/40" strokeWidth={2} />
                <circle cx={x(i)} cy={y(p.share)} r={mine ? 6 : 4} className={p.count > 0 ? "fill-data-good-ink" : "fill-muted-foreground"} />
                {mine ? <circle cx={x(i)} cy={y(p.share)} r={9} className="fill-none stroke-foreground" strokeWidth={2} /> : null}
              </ChartHit>
            );
          })}
        </svg>
      </ChartTips>
    </div>
  );
}
