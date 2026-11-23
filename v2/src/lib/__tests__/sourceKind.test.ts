import { describe, expect, it } from "vitest";

import { SOURCE_KINDS, kindsOf } from "../sourceKind";

describe("source kinds", () => {
  it("are the three the site uses, in the order a switch shows them", () => {
    expect(SOURCE_KINDS).toEqual(["official", "measured", "community"]);
  });

  it("read one kind or a blend, each kind once, in the order given", () => {
    expect(kindsOf("community")).toEqual(["community"]);
    expect(kindsOf(["measured", "official"])).toEqual(["measured", "official"]);
    expect(kindsOf(["measured", "official", "measured"])).toEqual(["measured", "official"]);
  });
});
