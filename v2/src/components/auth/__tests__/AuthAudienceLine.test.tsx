import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AuthAudienceLine, AUTH_AUDIENCE } from "../AuthAudienceLine";
import { metadata as loginMetadata } from "@/app/(site)/(auth)/login/page";
import { metadata as signupMetadata } from "@/app/(site)/(auth)/signup/page";

/**
 * Sign-up and sign-in say they're for both audiences: the person waiting on their own case and the people managing
 * cases. Words only: no field asks which, so the form stays a heading, Google, email, an optional name, a password
 * and one line of small print.
 */
describe("who an account is for", () => {
  it("names both audiences in one line", () => {
    render(<AuthAudienceLine />);
    expect(screen.getByText(AUTH_AUDIENCE)).toBeInTheDocument();
    expect(AUTH_AUDIENCE).toMatch(/your own case/i);
    expect(AUTH_AUDIENCE).toMatch(/case you manage/i);
  });

  it.each([
    ["sign-up", "src/app/(site)/(auth)/signup/SignupPageClient.tsx"],
    ["sign-in", "src/app/(site)/(auth)/login/LoginPageClient.tsx"],
  ])("sits under the %s heading", (_, file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toMatch(/<\/h1>(\{" "\})?\s*<AuthAudienceLine \/>/);
  });

  it("and the pages' descriptions say the same", () => {
    for (const m of [signupMetadata, loginMetadata]) {
      expect(String(m.description)).toMatch(/your own case/i);
      expect(String(m.description)).toMatch(/case you manage/i);
    }
  });
});
