/**
 * An admin line never breaks a word at any letter.
 *
 * `break-all` lets a line break between any two characters. On a line that holds an address and then words, a
 * phone printed "(watches a case on th" and "e site)" (the reviews list, Nov 13 2026). `overflow-wrap: anywhere`
 * wraps between words first and breaks a word only when it's too long for the line by itself, which is all an
 * email, a case number or a link needs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ADMIN = join(process.cwd(), "src/components/admin");
/** A webhook's address sits beside the words "a deleted endpoint" on the same line. */
const ALSO = [join(process.cwd(), "src/components/settings/WebhooksSection.tsx")];

/** A value's box that holds one token and nothing else may still break anywhere: a key, a secret, a command. */
const TOKEN_ONLY = /<code className="[^"]*\bbreak-all\b/;

function offenders(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bbreak-all\b/.test(line) && !TOKEN_ONLY.test(line))
    .map(({ line, n }) => `${file.replace(process.cwd() + "/", "")}:${n}: ${line.trim().slice(0, 90)}`);
}

describe("admin lines wrap between words", () => {
  it("no admin component, and no line that mixes an address with words, uses break-all", () => {
    // Arrange
    const files = [
      ...readdirSync(ADMIN)
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join(ADMIN, f)),
      ...ALSO,
    ];
    // Act
    const found = files.flatMap(offenders);
    // Assert
    expect(found).toEqual([]);
  });

  it("would catch the line that split the word", () => {
    // The probe: the reviews list's own line as it was.
    const was = '<dd className="break-all">{`${r.email} (watches a case on the site)`}</dd>';
    expect(/\bbreak-all\b/.test(was) && !TOKEN_ONLY.test(was)).toBe(true);
    // A key in its own box is left alone.
    expect(TOKEN_ONLY.test('<code className="min-w-0 flex-1 break-all bg-tint px-3 py-2 font-mono text-sm">')).toBe(true);
  });
});
