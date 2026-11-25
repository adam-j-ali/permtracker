/**
 * No receipt number in copy can be a real person's case: every receipt-shaped number in pages, components, stories,
 * Convex functions, articles and the article-capture list is one of the examples in exampleReceipts.ts, which sit
 * where USCIS hasn't issued numbers yet. Test files are outside this gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECEIPT_PREFIXES } from '../receipt';
import { EXAMPLE_RECEIPTS } from '../exampleReceipts';

const ROOT = process.cwd();
const COPY = /\.(tsx?|mdx|md|json|txt)$/;
const TEST = /(^|\/)(__tests__|__mocks__|node_modules|_generated|fixtures)(\/|$)|\.(test|spec)\.tsx?$/;

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`;
      if (TEST.test(path)) continue;
      if (statSync(join(ROOT, path)).isDirectory()) walk(path);
      else if (COPY.test(name)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

const SHAPE = new RegExp(`\\b(?:${Object.keys(RECEIPT_PREFIXES).join('|')})\\d{10}\\b`, 'g');
const ALLOWED = new Set<string>(EXAMPLE_RECEIPTS);

export function receiptsOutsideExamples(text: string): string[] {
  return [...new Set(text.match(SHAPE) ?? [])].filter((r) => !ALLOWED.has(r));
}

describe('receipt numbers in copy are only the examples', () => {
  it('finds none outside exampleReceipts.ts', () => {
    const hits = [...files('src'), ...files('content'), ...files('convex'), 'scripts/article-shots.json']
      .flatMap((f) => receiptsOutsideExamples(readFileSync(join(ROOT, f), 'utf8')).map((r) => `${f}: ${r}`));
    expect(hits).toEqual([]);
  });

  it('catches a planted real-looking number and passes the examples', () => {
    expect(receiptsOutsideExamples('Your number looks like EAC3590000001.')).toEqual(['EAC3590000001']);
    expect(receiptsOutsideExamples(`Try ${EXAMPLE_RECEIPTS.join(' or ')}.`)).toEqual([]);
  });
});
