/**
 * Reading a pasted list of case numbers: what's a number, what isn't, and what the reader is told about the rest.
 */
import { describe, expect, it } from "vitest";

import { CASES_PER_ADDRESS, LIST_TEXT_MAX, readCaseList, uniqueCaseNumbers } from "../caseList";

const A = "G-100-26125-868956";
const B = "G-100-26130-111111";
const WAGE = "P-100-26125-868956";
const JOB_ORDER = "JO-A-300-26271-264525";

describe("reading a pasted list", () => {
  it("reads one number per line", () => {
    expect(readCaseList(`${A}\n${B}\n`).numbers).toEqual([A, B]);
  });

  it("reads numbers separated by commas, semicolons, spaces and tabs", () => {
    expect(readCaseList(`${A}, ${B};${WAGE}\t${JOB_ORDER}`).numbers).toEqual([A, B, WAGE, JOB_ORDER]);
  });

  it("reads a spreadsheet row with other columns beside the number", () => {
    // Arrange: a name, the number, a date and a note, as a copied row comes out.
    const row = `Sample Worker\t${A}\t2025-04-10\tSoftware Engineer (L3)`;
    // Act
    const read = readCaseList(row);
    // Assert: the number is read, and the row isn't called unread for its other cells.
    expect(read.numbers).toEqual([A]);
    expect(read.unread).toEqual([]);
  });

  it("reads a number in lower case, in quotes, in brackets or ending a sentence", () => {
    expect(readCaseList(`"${A.toLowerCase()}"`).numbers).toEqual([A]);
    expect(readCaseList(`(${A})`).numbers).toEqual([A]);
    expect(readCaseList(`The case is ${A}.`).numbers).toEqual([A]);
    expect(readCaseList(`Case: ${A}:`).numbers).toEqual([A]);
  });

  it("keeps each number once, in the order first seen, and counts the repeats", () => {
    const read = readCaseList(`${B}\n${A}\n${B}\n${b()}`);
    expect(read.numbers).toEqual([B, A]);
    expect(read.repeats).toBe(2);
  });

  it("lists a line with no case number on it, and skips an empty one", () => {
    const read = readCaseList(`Name\tCase number\n\n${A}\nG-100-2612-868956\n   \n`);
    expect(read.numbers).toEqual([A]);
    expect(read.unread).toEqual(["Name\tCase number", "G-100-2612-868956"]);
  });

  it("cuts a long unread line short", () => {
    const [line] = readCaseList("x".repeat(90)).unread;
    expect(line).toBe(`${"x".repeat(40)}...`);
  });

  it("doesn't read the old three-part number, which the alert can't watch", () => {
    const read = readCaseList("A-23043-00641");
    expect(read.numbers).toEqual([]);
    expect(read.unread).toEqual(["A-23043-00641"]);
  });

  it("reads nothing from an empty paste", () => {
    expect(readCaseList("")).toEqual({ numbers: [], unread: [], repeats: 0 });
  });

  it("stops at its length limit, however much is pasted", () => {
    // Arrange: far more numbers than the limit holds.
    const many = Array.from({ length: 5000 }, (_, i) => `G-100-26125-${String(100000 + i)}`).join("\n");
    expect(many.length).toBeGreaterThan(LIST_TEXT_MAX);
    // Act
    const read = readCaseList(many);
    // Assert: only what fits before the cut, and the cut number itself isn't invented.
    expect(read.numbers.length).toBeLessThanOrEqual(Math.ceil(LIST_TEXT_MAX / 19));
    expect(read.numbers.length).toBeGreaterThan(CASES_PER_ADDRESS);
  });

  it("answers at once for a megabyte with no line breaks", () => {
    const started = Date.now();
    readCaseList("G-".repeat(500_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("the server's reading of what a form sent", () => {
  it("normalises, drops what isn't a number, and keeps each once", () => {
    expect(uniqueCaseNumbers([a(), "nonsense", A, "", `${B} `, "x".repeat(200)])).toEqual([A, B]);
  });
});

function a(): string {
  return ` ${A.toLowerCase()} `;
}

function b(): string {
  return B.toLowerCase();
}
