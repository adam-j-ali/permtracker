import { describe, expect, it } from "vitest";

import { recruitmentStep } from "@convex/lib/perm/recruitment/steps";
import { RECRUITMENT_METHOD_TYPES } from "../resultsGenerator";

describe("the recruitment steps and the case form's methods", () => {
  it("give every method the case form stores a step, with its rule and proof, so none is left without a proof slot", () => {
    for (const method of Object.keys(RECRUITMENT_METHOD_TYPES)) expect(recruitmentStep(method)?.kind, method).toBe("additional");
  });
});
