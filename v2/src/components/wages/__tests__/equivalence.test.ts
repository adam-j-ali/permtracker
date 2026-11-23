import { describe, expect, it } from "vitest";

import { DEFAULT_RATE_FLOOR } from "@/components/tools/RateBars";
import { MIN_DECIDED_FOR_BAND_RATE } from "@/lib/wageLadder";

/**
 * The wage bands' rate floor equals the rate tables' floor.
 *
 * `wageLadder.ts` declares its own rather than importing RateBars', because
 * RateBars is a `"use client"` module and `wageLadder.ts` is reachable from a
 * `server-only` one: under RSC that import is a client reference, not a value,
 * and every wage band once rendered "withheld" with no error. This file lives in
 * the `components` project, where importing both is ordinary, and holds them equal.
 * The interval itself has one home (convex/lib/wilson.ts), so it needs no pin here.
 */
describe("wage-band statistics match the rate tables", () => {
  it("uses the same population floor", () => {
    expect(MIN_DECIDED_FOR_BAND_RATE).toBe(DEFAULT_RATE_FLOOR);
  });
});
