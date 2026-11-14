import Link from "next/link";

import { AppWindow } from "@/components/marketing/AppWindow";
import { EMPLOYER_SHOTS } from "@/components/marketing/employerShots";
import { TOUR_SHOTS } from "@/components/marketing/tourShots";
import { BandFacts } from "@/components/scroll/BandFacts";
import { StageBand } from "@/components/scroll/StageBand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { longDate } from "@convex/lib/months";

/**
 * The employers page's pictures, as bands: a real company's page, one of its cases, and the case tracker for the
 * people who run the cases themselves. Each is a dated capture of the page it names (scripts/page-pictures.json,
 * the "employers" set), beside what that page gives someone who keeps track of a company's cases, in three lines.
 * The facts describe what the pages do; when a page changes, its line and its capture change with it.
 */

const captured = (shot: keyof typeof EMPLOYER_SHOTS) => {
  const day = EMPLOYER_SHOTS[shot].captured;
  return day ? longDate(day) : null;
};

export function EmployersTour() {
  const company = EMPLOYER_SHOTS.company;
  const one = EMPLOYER_SHOTS.case;
  return (
    <div className="mt-14 border-t-2 border-black sm:mt-20">
      <StageBand
        measure="max-w-7xl px-4 sm:px-6"
        id="company-page"
        index={0}
        flip={false}
        ink={false}
        title="Every case, by where it stands"
        lead="Your company's page counts the cases waiting at the Labor Department by DOL's own status, and lists the newest with each one's job title, filing date and status."
        picture={
          <AppWindow
            url="permtracker.app/perm-employers/nvidia-corporation"
            shots={company.shots}
            alt={company.alt}
            caption={captured("company") ? `NVIDIA Corporation's page, captured ${captured("company")}.` : null}
          />
        }
      >
        <BandFacts
          facts={[
            "Waiting cases counted by status: analyst review, a request for information, on hold, under appeal",
            "Every case number opens that case's own page",
            "How long DOL has taken on its decided cases, beside every other sponsor",
          ]}
        />{" "}
        <p className="mt-6">
          <a href="#find" className={buttonVariants({ variant: "outline", size: "lg" })}>
            Find your company
          </a>
        </p>
      </StageBand>{" "}
      <StageBand
        measure="max-w-7xl px-4 sm:px-6"
        id="one-case"
        index={1}
        flip
        ink
        title="One case, down to the day"
        lead="Each case has its own page: the status DOL shows now, every change it has made, and for a case still waiting, when DOL will likely decide it."
        picture={
          <AppWindow
            url="permtracker.app/perm-case-status"
            shots={one.shots}
            alt={one.alt}
            caption={captured("case") ? `One of its waiting cases, captured ${captured("case")}.` : null}
            onBand
          />
        }
      >
        <BandFacts
          ink
          facts={[
            "An estimated decision date, from the pace DOL is deciding at now",
            "How many cases filed earlier are still ahead of it",
            "Its own email alert, checked every five minutes on weekdays",
          ]}
        />{" "}
        <p className="mt-6">
          <Link href="/perm-case-status" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "text-foreground")}>
            Look a case up
          </Link>
        </p>
      </StageBand>{" "}
      <StageBand
        measure="max-w-7xl px-4 sm:px-6"
        id="case-tracker"
        index={2}
        flip={false}
        ink={false}
        title="Running the cases yourself?"
        lead="Paralegals and case managers get a case tracker. Enter a case's dates once, and every deadline from the wage request to the I-140 is worked out, with a reminder before each."
        picture={
          <AppWindow
            url="permtracker.app/cases"
            shots={TOUR_SHOTS.cases}
            alt="The case tracker's cases page showing sample cases as cards, each with its stage, its next deadline and the days left."
            caption="Sample cases."
          />
        }
      >
        <BandFacts
          facts={[
            "Wage expiration, recruitment windows, the filing window and the I-140 cutoff, per case",
            "Reminders by email, and each deadline on your calendar",
            "Free, with cases imported from a file or typed in",
          ]}
        />{" "}
        <p className="mt-6">
          <Link href="/for-attorneys" className={buttonVariants({ variant: "outline", size: "lg" })}>
            See the case tracker
          </Link>
        </p>
      </StageBand>
    </div>
  );
}
