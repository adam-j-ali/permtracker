// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { linkThatLeaves, useUnsavedChanges } from "../useUnsavedChanges";

/**
 * A form holding unsaved work asks before a click on an in-app link takes it away. Back and refresh were
 * guarded and links weren't: the header, the breadcrumb or "view the existing case" left at once, with a new
 * case's dates gone.
 */
const HERE = "https://permtracker.app/cases/new";

function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.innerHTML = "<span>Cases</span>";
  document.body.append(a);
  return a;
}

function click(target: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  // Inside act: the guard sets state from a document listener, outside any React event.
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("which clicks leave the page", () => {
  const at = (el: Element, init: Partial<MouseEvent> = {}) =>
    linkThatLeaves(
      { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, target: el, ...init },
      HERE,
    );

  it("a plain click on a link to another page of the site, from anywhere inside the link", () => {
    const a = link("/cases");
    expect(at(a)).toBe("https://permtracker.app/cases");
    expect(at(a.querySelector("span")!)).toBe("https://permtracker.app/cases");
  });

  it("not a new tab, a download, a modified click or a right click: the form stays on screen", () => {
    expect(at(link("/cases", { target: "_blank" }))).toBeNull();
    expect(at(link("/export.csv", { download: "" }))).toBeNull();
    expect(at(link("/cases"), { metaKey: true })).toBeNull();
    expect(at(link("/cases"), { ctrlKey: true })).toBeNull();
    expect(at(link("/cases"), { button: 1 })).toBeNull();
  });

  it("not a jump within this page, and not another site (the browser asks about that itself)", () => {
    expect(at(link("#dates"))).toBeNull();
    expect(at(link("/cases/new#dates"))).toBeNull();
    expect(at(link("https://flag.dol.gov/"))).toBeNull();
  });

  it("not a click on something that isn't a link", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(at(button)).toBeNull();
  });
});

describe("the form's guard on in-app links", () => {
  it("asks before leaving when the form holds unsaved work", () => {
    const { result } = renderHook(() => useUnsavedChanges());
    act(() => result.current.setDirty(true));

    const event = click(link("/cases"));
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.shouldShowDialog).toBe(true);

    act(() => result.current.cancelNavigation());
    expect(result.current.shouldShowDialog).toBe(false);
  });

  it("lets the click through when nothing is unsaved, or while the form is saving", () => {
    const clean = renderHook(() => useUnsavedChanges());
    expect(click(link("/cases")).defaultPrevented).toBe(false);
    expect(clean.result.current.shouldShowDialog).toBe(false);
    clean.unmount();

    const saving = renderHook(() => useUnsavedChanges({ initialDirty: true, isSubmitting: true }));
    expect(click(link("/cases")).defaultPrevented).toBe(false);
    saving.unmount();
  });

  it("lets a new-tab link through with unsaved work, since the form stays open", () => {
    const { result } = renderHook(() => useUnsavedChanges({ initialDirty: true }));
    expect(click(link("/cases/abc", { target: "_blank" })).defaultPrevented).toBe(false);
    expect(result.current.shouldShowDialog).toBe(false);
  });
});
