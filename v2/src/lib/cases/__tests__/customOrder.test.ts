import { describe, expect, it } from "vitest";

import { compareByCustomOrder, orderLookup, placeIn } from "../customOrder";

describe("the order a person set by hand", () => {
  const order = orderLookup(["first", "second", "third"]);

  it("gives the first case its place, which is zero", () => {
    expect(placeIn(order, "first")).toBe(0);
    expect(placeIn(order, "missing")).toBeUndefined();
  });

  it("keeps the case placed first ahead of every other ordered case", () => {
    const ids = ["third", "first", "second"];
    ids.sort((a, b) => compareByCustomOrder(order, a, b) || 0);
    expect(ids).toEqual(["first", "second", "third"]);
  });

  it("puts a case that isn't on the list after the ones that are", () => {
    expect(compareByCustomOrder(order, "first", "new")).toBeLessThan(0);
    expect(compareByCustomOrder(order, "new", "first")).toBeGreaterThan(0);
  });

  it("leaves two cases that aren't on the list to the caller", () => {
    expect(compareByCustomOrder(order, "new", "newer")).toBeUndefined();
  });
});
