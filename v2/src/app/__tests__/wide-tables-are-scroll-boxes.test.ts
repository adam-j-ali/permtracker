import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * A table that scrolls sideways is a `ScrollBox`, links in its rows or not: a link takes focus in its own column,
 * so the columns beside it with no link stay out of a keyboard's reach. The scroll-box scan spares a box whose
 * table holds a control; these wide tables, found by the Nov 9 review, are held to the rule itself.
 */
const WIDE_TABLES = [
  "src/components/activity/DecidedTable.tsx",
  "src/components/activity/ChangeTable.tsx",
  "src/components/entities/EmployerYears.tsx",
  "src/components/data/SevpRowsTable.tsx",
];

const PLAIN_BOX = /<div\b[^>]*\boverflow-x-auto\b[^>]*>\s*(?:\{\/\*[^*]*\*\/\}\s*)?<table\b/g;

describe("wide tables are scroll boxes", () => {
  it("finds a plain sideways box around a table, comment and all", () => {
    // Arrange, Act, Assert
    expect('<div className="mt-4 overflow-x-auto">\n<table>'.match(PLAIN_BOX)).toHaveLength(1);
    expect('<div className="mt-4 overflow-x-auto">\n  {/* Fixed columns. */}\n  <table>'.match(PLAIN_BOX)).toHaveLength(1);
    expect('<ScrollBox label="Rows" className="mt-4">\n<table>'.match(PLAIN_BOX)).toBeNull();
  });

  it.each(WIDE_TABLES)("%s draws its table in a ScrollBox", (path) => {
    expect(readFileSync(path, "utf8").match(PLAIN_BOX)).toBeNull();
  });
});
