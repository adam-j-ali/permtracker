// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * The last setup step says only what's true in every way of reaching it. It used to decide "this person skipped"
 * from state held in memory, so after a reload someone who had made a real case read "We added a sample case"
 * before any existed, and someone who made a case was given the sample without a word.
 */
const onboarding = vi.hoisted(() => ({ onboardingCaseInfo: null as null | { employerName: string; positionTitle: string } }));
vi.mock("../../OnboardingProvider", () => ({ useOnboarding: () => onboarding }));
vi.mock("@/components/illustrations/CertifiedFormArt", () => ({ CertifiedFormArt: () => null }));

import { CompletionStep } from "../CompletionStep";

const SAMPLE_LINE = /Your account comes with a sample case, marked Sample/;

describe("the last setup step", () => {
  it("tells someone who made a case that a sample comes too", () => {
    onboarding.onboardingCaseInfo = { employerName: "Acme Corp", positionTitle: "Engineer" };
    render(<CompletionStep onTakeTour={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/Your first case is ready/)).toBeInTheDocument();
    expect(document.body.textContent).toMatch(SAMPLE_LINE);
  });

  it("never says a sample was already added, with the visit's own case forgotten", () => {
    onboarding.onboardingCaseInfo = null;
    render(<CompletionStep onTakeTour={() => {}} onSkip={() => {}} />);
    expect(document.body.textContent).toMatch(SAMPLE_LINE);
    expect(document.body.textContent).not.toMatch(/We added/);
    expect(screen.queryByText(/Your first case is ready/)).toBeNull();
  });
});
