"use client";

import { CertifiedFormArt } from "@/components/illustrations/CertifiedFormArt";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "../OnboardingProvider";

interface CompletionStepProps {
  onTakeTour: () => void;
  onSkip: () => void;
}

export function CompletionStep({ onTakeTour, onSkip }: CompletionStepProps) {
  const { onboardingCaseInfo } = useOnboarding();

  // The case just made in this visit, held in memory only. After a reload it's gone, so nothing here may claim
  // the person skipped: the words below are true whether they made a case, skipped, or came back to this step.
  const madeACase = Boolean(onboardingCaseInfo);

  return (
    <div className="flex flex-col items-center text-center px-2">
      <div className="mb-6">
        <CertifiedFormArt className="w-52 sm:w-60" />
      </div>

      <h2 className="font-heading text-2xl sm:text-3xl font-bold mb-2">
        {madeACase ? "You\u2019re all set" : "Welcome aboard"}
      </h2>

      {onboardingCaseInfo && (
        <div className="mb-4 inline-flex items-center gap-2 bg-tint px-4 py-2 border-2 shadow-hard-sm border-border">
          <span className="text-sm">
            <span className="font-heading font-semibold">
              {onboardingCaseInfo.employerName}
            </span>
            {", "}
            <span className="text-muted-foreground">
              {onboardingCaseInfo.positionTitle}
            </span>
          </span>
        </div>
      )}

      {/* Every account gets the sample: at the skip, or as this step is left. Said to everyone, in words that hold
          on both sides of that moment. */}
      <div className="mb-4 inline-flex items-center gap-2 border-2 border-dashed border-border px-4 py-2">
        <span className="text-sm text-muted-foreground">
          Your account comes with a <span className="font-semibold text-foreground">sample case</span>, marked
          Sample, so there&apos;s something to explore. Delete it anytime.
        </span>
      </div>

      <p className="text-muted-foreground text-sm max-w-xs mb-8">
        {madeACase
          ? "Your first case is ready. Take a quick tour to see where everything is, or jump straight into your dashboard."
          : "Take a quick tour to see where everything is, or jump straight into your dashboard."}
      </p>

      <div className="w-full max-w-sm space-y-3">
        <Button
          onClick={onTakeTour}
          size="lg"
          className="w-full"
        >
          Take a quick tour
        </Button>

        <Button
          onClick={onSkip}
          variant="ghost"
          size="lg"
          className="w-full text-muted-foreground text-sm"
        >
          Skip for now
        </Button>
      </div>

      <p className="text-muted-foreground text-sm mt-4">
        You can always replay the tour from Support in Settings.
      </p>
    </div>
  );
}
