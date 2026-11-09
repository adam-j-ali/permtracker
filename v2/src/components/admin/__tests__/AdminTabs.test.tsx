import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminTabs } from "../AdminTabs";

/**
 * The admin tab is the address's #section. An emailed link to /admin#reviews that went through sign-in had
 * opened Overview (Nov 4 2026), and a hash read only once missed every later change.
 */
const tabs = [
  { id: "overview", label: "Overview", content: <p>overview body</p> },
  { id: "reviews", label: "Reviews", content: <p>reviews body</p> },
  { id: "alerts", label: "Alerts and email", content: <p>alerts body</p> },
];

const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("AdminTabs", () => {
  it("opens on the section the address names", () => {
    window.history.replaceState(null, "", "/admin#reviews");
    render(<AdminTabs tabs={tabs} />);
    expect(selected()).toBe("Reviews");
    expect(screen.getByText("reviews body")).toBeTruthy();
  });

  it("opens on the first tab for no section or one that isn't a tab", () => {
    window.history.replaceState(null, "", "/admin#nope");
    render(<AdminTabs tabs={tabs} />);
    expect(selected()).toBe("Overview");
  });

  it("puts a chosen tab in the address", () => {
    window.history.replaceState(null, "", "/admin?x=1");
    render(<AdminTabs tabs={tabs} />);
    fireEvent.click(screen.getByRole("tab", { name: /Alerts/ }));
    expect(selected()).toBe("Alerts and email");
    expect(window.location.hash).toBe("#alerts");
    expect(window.location.search).toBe("?x=1");
  });

  it("follows a section that changes while the page is open, and Back", () => {
    window.history.replaceState(null, "", "/admin#overview");
    render(<AdminTabs tabs={tabs} />);
    act(() => {
      window.location.hash = "#reviews";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(selected()).toBe("Reviews");
    act(() => {
      window.history.replaceState(null, "", "/admin#alerts");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(selected()).toBe("Alerts and email");
  });

  it("draws a picked tab's count in the tab's own ink, never grey on lime", () => {
    // Arrange: grey on the lime pick measured about 3:1, and 1.2:1 in the dark theme
    window.history.replaceState(null, "", "/admin#reviews");
    render(<AdminTabs tabs={[tabs[0]!, { ...tabs[1]!, badge: "4" }, tabs[2]!]} />);
    // Act
    const badge = screen.getByText("4");
    // Assert
    expect(badge.className).not.toMatch(/text-muted-foreground/);
    expect(badge.className).toMatch(/text-current/);
  });
});

