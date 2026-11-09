import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { csvDate, csvToCases, fieldForHeader, looksLikeCsv, parseCsv } from "../csvImport";

/**
 * A spreadsheet saved as CSV imports the way a JSON file does: every column the sheet's header names lands in
 * its case field with the field's type, and everything it can't place is named, never dropped quietly.
 */
describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes, line breaks inside quotes, Windows line ends and a byte order mark", () => {
    // Arrange
    const text = '﻿Employer,Notes\r\n"Acme, Inc.","She said ""soon""\r\nthen waited"\r\n';
    // Act
    const rows = parseCsv(text);
    // Assert
    expect(rows).toEqual([
      ["Employer", "Notes"],
      ["Acme, Inc.", 'She said "soon"\r\nthen waited'],
    ]);
  });

  it("skips empty lines, including the trailing ones a spreadsheet leaves", () => {
    expect(parseCsv("A,B\n1,2\n,\n\n")).toEqual([["A", "B"], ["1", "2"]]);
  });
});

describe("csvDate", () => {
  it.each([
    ["2026-03-05", "2026-03-05"],
    ["2026/3/5", "2026-03-05"],
    ["3/5/2026", "2026-03-05"],
    ["3/5/26", "2026-03-05"],
    ["25/3/2026", "2026-03-25"],
    ["March 5, 2026", "2026-03-05"],
    ["Mar 5 2026", "2026-03-05"],
    ["5-Mar-26", "2026-03-05"],
    ["5 March 2026", "2026-03-05"],
    ["46086", "2026-03-05"],
    ["2026-03-05T00:00:00", "2026-03-05"],
  ])("reads %s as %s", (input, want) => {
    expect(csvDate(input)).toBe(want);
  });

  it.each(["2026-02-30", "13/13/2026", "soon", "", "12345", `March 5, 2026${" ".repeat(60)}x`])("refuses %s", (input) => {
    expect(csvDate(input)).toBeUndefined();
  });

  it("gives the same day in any time zone, because it reads the text, never a clock", () => {
    // Arrange: a reader east of UTC once saw a day earlier through new Date().toISOString().
    const before = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";
    try {
      // Act, Assert
      expect(csvDate("3/5/2026")).toBe("2026-03-05");
    } finally {
      process.env.TZ = before;
    }
  });
});

describe("fieldForHeader", () => {
  it.each([
    ["employerName", "employerName"],
    ["Employer", "employerName"],
    ["Foreign worker", "beneficiaryIdentifier"],
    ["PWD filed", "pwdFilingDate"],
    ["pwd_determination_date", "pwdDeterminationDate"],
    ["First Sunday ad", "sundayAdFirstDate"],
    ["PERM filed", "eta9089FilingDate"],
    ["Certified", "eta9089CertificationDate"],
    ["I-140 receipt number", "i140ReceiptNumber"],
  ])("matches %s to %s", (header, field) => {
    expect(fieldForHeader(header)).toBe(field);
  });

  it("matches nothing for a header it doesn't know", () => {
    expect(fieldForHeader("Priority date")).toBeUndefined();
  });
});

describe("csvToCases", () => {
  it("turns each row into a case with typed fields", () => {
    // Arrange
    const text = [
      "Employer,Foreign worker,Job title,PWD filed,Wage,Professional,PERM filed,Notes",
      'Acme Inc,Worker A,Data analyst,3/5/2026,"$98,500",yes,2026-09-01,Waiting on DOL',
    ].join("\n");
    // Act
    const { cases, notes } = csvToCases(text);
    // Assert
    expect(notes).toEqual([]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      employerName: "Acme Inc",
      beneficiaryIdentifier: "Worker A",
      positionTitle: "Data analyst",
      pwdFilingDate: "2026-03-05",
      pwdWageAmount: 98500,
      isProfessionalOccupation: true,
      eta9089FilingDate: "2026-09-01",
    });
    expect((cases[0]!.notes as Array<{ content: string }>)[0]!.content).toBe("Waiting on DOL");
  });

  it("reads this app's own CSV export back, bookkeeping columns set aside without a note", () => {
    // Arrange
    const text = "_id,employerName,beneficiaryIdentifier,caseStatus,createdAt,updatedAt\nabc,Acme Inc,Worker A,pwd,1,2";
    // Act
    const { cases, notes } = csvToCases(text);
    // Assert
    expect(notes).toEqual([]);
    expect(cases[0]).toEqual({ employerName: "Acme Inc", beneficiaryIdentifier: "Worker A", caseStatus: "pwd" });
  });

  it("names a column it can't place, a second column for the same field, and a cell it can't read", () => {
    // Arrange
    const text = "Employer,Company,Priority date,Wage,Professional\nAcme Inc,Other Inc,2020-01-01,lots,maybe";
    // Act
    const { cases, notes } = csvToCases(text);
    // Assert
    expect(cases[0]).toEqual({ employerName: "Acme Inc" });
    expect(notes.map((n) => [n.row, n.column, n.employerName])).toEqual([
      [-1, "Company", undefined],
      [-1, "Priority date", undefined],
      [0, "Wage", "Acme Inc"],
      [0, "Professional", "Acme Inc"],
    ]);
  });

  it("keeps an unreadable date as typed, so the import's date check names it", () => {
    const { cases } = csvToCases("Employer,PWD filed\nAcme Inc,sometime in March");
    expect(cases[0]!.pwdFilingDate).toBe("sometime in March");
  });

  it("reads nothing from a file with only a header", () => {
    expect(csvToCases("Employer,Job title\n").cases).toEqual([]);
  });
});

describe("looksLikeCsv", () => {
  it("goes by the file name first, then by the text", () => {
    expect(looksLikeCsv("cases.csv", '{"a":1}')).toBe(true);
    expect(looksLikeCsv("cases.json", "a,b")).toBe(false);
    expect(looksLikeCsv("cases", "Employer,Job title\nAcme,Analyst")).toBe(true);
    expect(looksLikeCsv("cases", '[{"employerName":"Acme"}]')).toBe(false);
  });
});

describe("the downloadable template", () => {
  it("imports with every column matched and its example row read", () => {
    // Arrange: the file /templates/perm-case-import-template.csv serves.
    const text = readFileSync(join(process.cwd(), "public/templates/perm-case-import-template.csv"), "utf8");
    // Act
    const { cases, matched, notes } = csvToCases(text);
    // Assert
    expect(notes).toEqual([]);
    expect(matched.length).toBe(parseCsv(text)[0]!.length);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ employerName: "Example Employer Inc", jobOrderStartDate: "2026-05-04", isProfessionalOccupation: true });
  });
});

