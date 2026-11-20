import Link from "next/link";

import { PageSection } from "@/components/data/PageSection";
import { ScrollBox } from "@/components/ui/scroll-box";
import { SocCodeLink } from "@/components/soc/SocCodeLink";
import { LevelEstimator } from "@/components/tools/LevelEstimator";
import { formatDay } from "@/lib/dolFormat";
import type { PwdLikely } from "@/lib/db/pwdLikely";
import { DEGREE_LABELS, degreeOf } from "@/lib/wageLevelEstimate";

/**
 * A pending wage request's likely code, wages and level (src/lib/db/pwdLikely.ts), on its case page: the parts DOL
 * hasn't set yet, each labelled an estimate and with where it comes from. The level estimate takes the job's own
 * requirements, so the reader can sharpen it (LevelEstimator; nothing typed there leaves the page).
 */
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const LEVELS = ["Level I", "Level II", "Level III", "Level IV"] as const;

export function PwdLikelySection({ likely, jobTitle, state }: { likely: PwdLikely; jobTitle: string | null; state: string | null }) {
  const { past, soc, area, levels } = likely;
  const pastLevels = past.map((p) => p.level).filter((l): l is string => !!l);
  const usual = pastLevels.length
    ? [...new Set(pastLevels)].map((l) => [l, pastLevels.filter((x) => x === l).length] as const).sort((a, b) => b[1] - a[1])[0]
    : null;
  // The estimate starts from the requirements on the employer's newest determination for the title, so its answer
  // reads the same evidence as the cards above; the reader changes them to match this request.
  const seed = past.find((p) => degreeOf(p.education) !== null);
  const seedDegree = seed ? degreeOf(seed.education) : null;
  const toolHref = soc ? `/tools/wage-levels?soc=${encodeURIComponent(soc.code)}${state ? `&state=${encodeURIComponent(state)}` : ""}` : "/tools/wage-levels";

  return (
    <PageSection
      id="likely-wage"
      title="What DOL will likely set"
      lede="An estimate. DOL's live record gives only the employer, the job title and the filing day, so this is worked out from what DOL decided before for the same job."
    >
      {past.length ? (
        <>
          <p className="text-base">
            {`This employer's past wage requests for ${jobTitle ? `"${jobTitle}"` : "this job"}, as DOL decided them:`}
          </p>
          {past.length > 6 ? <p className="mt-1 text-sm text-muted-foreground">{`The newest 6 of ${past.length}.`}</p> : null}{" "}
          <ScrollBox label="The employer's past determinations for the same job title" className="mt-3">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">The employer&apos;s past determinations for the same job title</caption>
              <thead>
                <tr className="border-b-2 border-border bg-sage text-left">
                  <th scope="col" className="p-2 font-bold">Determined{" "}</th>
                  <th scope="col" className="p-2 font-bold">Job code{" "}</th>
                  <th scope="col" className="p-2 font-bold">Level{" "}</th>
                  <th scope="col" className="p-2 text-right font-bold">Wage{" "}</th>
                  <th scope="col" className="p-2 font-bold">Worksite{" "}</th>
                </tr>
              </thead>
              <tbody>
                {past.slice(0, 6).map((p) => (
                  <tr key={p.caseNumber} className="border-b border-border/50">
                    <td className="p-2">
                      <Link href={`/perm-case-status?case=${encodeURIComponent(p.caseNumber)}`} className="link">
                        {formatDay(p.determinedOn) ?? p.caseNumber}
                      </Link>{" "}
                    </td>
                    <td className="p-2">{p.socCode ? <SocCodeLink code={p.socCode} /> : "Not given"}{" "}</td>
                    <td className="p-2">{`${p.level ? `Level ${p.level}` : "Not given"} `}</td>
                    <td className="p-2 text-right tabular-nums">{p.wage ? `${usd(p.wage)}${p.wageUnit && p.wageUnit.toLowerCase() !== "year" ? ` a ${p.wageUnit.toLowerCase()}` : ""} ` : "Not given "}</td>
                    <td className="p-2">{`${[p.worksiteCity, p.worksiteState].filter(Boolean).join(", ") || "Not given"} `}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollBox>
        </>
      ) : null}{" "}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
        {soc ? (
          <div className="border-2 border-border bg-card p-4">
            <p className="text-sm font-bold text-muted-foreground">Likely job code</p>{" "}
            <p className="mt-1 font-heading text-xl font-bold">
              <SocCodeLink code={soc.code} />
              {soc.title ? ` ${soc.title}` : ""}
            </p>{" "}
            <p className="mt-1 text-sm text-muted-foreground">
              {soc.basis === "employer"
                ? `The code DOL used on ${Math.round((soc.share ?? 1) * past.length)} of this employer's ${past.length} past determinations for the title.`
                : `The code employers file this title under most often${soc.share ? `, ${Math.round(soc.share * 100)}% of filings` : ""}. DOL may choose another from the duties.`}
            </p>
          </div>
        ) : null}{" "}
        {usual ? (
          <div className="border-2 border-border bg-card p-4">
            <p className="text-sm font-bold text-muted-foreground">The level DOL gave this job before</p>{" "}
            <p className="mt-1 font-heading text-xl font-bold">{`Level ${usual[0]}`}</p>{" "}
            <p className="mt-1 text-sm text-muted-foreground">{`On ${usual[1]} of ${pastLevels.length} of the employer's past determinations for the title.`}</p>
          </div>
        ) : null}
      </div>{" "}
      {levels && area ? (
        <div className="mt-5">
          <p className="text-base font-bold">{`DOL's four wages for the code in ${area.name ?? "the job's area"}, ${levels.wageYear}-${String(levels.wageYear + 1).slice(2)}`}</p>{" "}
          {area.city && past.length ? (
            <p className="text-sm text-muted-foreground">{`Where ${area.jobs} of the employer's ${past.length} past determinations for the title put the job (${area.city}). The worksite on this request may differ.`}</p>
          ) : null}{" "}
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 [&>*]:min-w-0">
            {levels.yearly.map((y, i) => (
              <li key={LEVELS[i]} className="border-2 border-border bg-card p-3">
                <span className="block text-sm text-muted-foreground">{LEVELS[i]}</span>{" "}
                <span className="font-heading text-lg font-bold tabular-nums">{y ? `${usd(y)} a year` : "Not published"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : soc ? (
        <p className="mt-5 text-base">
          <Link href={toolHref} className="link font-bold">
            See DOL&apos;s four wages for the code in the job&apos;s area
          </Link>
        </p>
      ) : null}{" "}
      {soc && seed && seedDegree ? (
        <p className="mt-5 text-sm text-muted-foreground">
          {`The level estimate below starts from what the employer's newest request for the title asked for (${DEGREE_LABELS[seedDegree].toLowerCase()}${seed.experienceMonths ? `, ${seed.experienceMonths} months of experience` : ""}). Change the answers to match this request.`}
        </p>
      ) : null}{" "}
      {soc ? <LevelEstimator key={soc.code} soc={soc.code} initialDegree={seedDegree ?? undefined} initialMonths={seed?.experienceMonths ?? undefined} /> : null}
    </PageSection>
  );
}
