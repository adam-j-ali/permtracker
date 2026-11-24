import { renderToStaticMarkup } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeepWhole } from "@/components/ui/keep-whole";

import { htmlText, textContent, wholeText } from "./text-content";

describe("wholeText, for a role query's name", () => {
  it("finds a heading by the words it shows, where the test DOM's name puts a space before a comma", () => {
    render(
      <h2>
        <KeepWhole>Its newest 2 H-2A, H-2B and CW-1 filings</KeepWhole>
      </h2>,
    );
    expect(screen.queryByRole("heading", { name: "Its newest 2 H-2A, H-2B and CW-1 filings" })).toBeNull();
    expect(screen.getByRole("heading", { name: wholeText("Its newest 2 H-2A, H-2B and CW-1 filings") })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: wholeText("Its newest 3 H-2A, H-2B and CW-1 filings") })).toBeNull();
  });
});

describe("htmlText, a server render's words", () => {
  it("reads a sentence KeepWhole split into spans as one, entities as React wrote them", () => {
    const html = renderToStaticMarkup(
      <p>
        <KeepWhole>USCIS&apos;s I-485 at Hartford</KeepWhole>
      </p>,
    );
    expect(html).not.toContain("I-485 at Hartford");
    expect(htmlText(html)).toBe("USCIS&#x27;s I-485 at Hartford");
  });
});

describe("textContent, a matcher for text across nodes", () => {
  it("finds a sentence KeepWhole split into spans, where getByText's own matcher can't", () => {
    render(
      <p data-testid="p">
        <KeepWhole>USCIS&apos;s median for the I-140</KeepWhole>
      </p>,
    );
    expect(screen.queryByText("USCIS's median for the I-140")).toBeNull();
    expect(screen.getByText(textContent("USCIS's median for the I-140")).textContent).toBe("USCIS's median for the I-140");
  });

  it("names the deepest element holding all of it, and only one", () => {
    render(
      <section>
        <div>
          <p>
            Top <b>H-1B</b> employers
          </p>
        </div>
      </section>,
    );
    expect(screen.getByText(textContent("Top H-1B employers")).tagName).toBe("P");
  });

  it("still fails on different words, so it checks what getByText checked", () => {
    render(<p>Top H-1B employers</p>);
    expect(screen.queryByText(textContent("Top H-2B employers"))).toBeNull();
    expect(screen.queryByText(textContent("Top H-1B"))).toBeNull();
    expect(screen.getByText(textContent(/^Top H-1B/))).toBeTruthy();
  });
});
