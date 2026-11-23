import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BLUE_STEPS, NONE_FILL, blueFill } from "@/lib/mapScale";

describe("the map scale", () => {
  it("is four steps of the information blue, the last the blue itself", () => {
    expect(BLUE_STEPS).toHaveLength(4);
    expect([...BLUE_STEPS].sort((a, b) => a - b)).toEqual([...BLUE_STEPS]);
    expect(blueFill(3)).toBe("color-mix(in srgb, var(--data-info) 100%, var(--card))");
    expect(blueFill(0)).toContain("var(--data-info) 25%");
  });

  it("keeps any step it's handed on the scale", () => {
    expect(blueFill(-1)).toBe(blueFill(0));
    expect(blueFill(9)).toBe(blueFill(3));
  });

  it("draws a zero as the plain card, never a hatch or a tint", () => {
    expect(NONE_FILL).toBe("var(--card)");
  });

  it("is the scale both state maps fill and key with, and neither uses a lime tint", () => {
    for (const file of ["src/components/tools/USStateMap.tsx", "src/components/entities/EntityStateMap.tsx"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).toContain('from "@/lib/mapScale"');
      expect(src, file).not.toMatch(/var\(--primary\)\s+\$\{|color-mix\(in srgb, var\(--primary\)/);
    }
  });
});
