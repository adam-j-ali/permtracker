/**
 * A Testing Library matcher for text drawn across several nodes: `screen.getByText(textContent("Top H-1B
 * employers"))`. When a sentence names a program, it's split into spans: KeepWhole keeps each name on one line.
 * getByText's own matcher reads only an element's direct text, so it no longer finds that sentence. This one
 * reads the element's whole text with its spaces collapsed, as getByText's would be. It names the deepest
 * element holding all of it, so it checks the same words in the same place.
 */
/**
 * A server render's text, its tags taken out: the same check for markup that `textContent` is for a DOM. A
 * sentence KeepWhole split into spans reads whole again, so `expect(htmlText(html)).toContain("I-485 at
 * Hartford")` checks the words a reader sees. Entities stay as React wrote them (`&#x27;`, `&amp;`), so an
 * assertion written against the markup's escaping still holds.
 */
export function htmlText(html: string): string {
  // Taken out until none is left, so a tag a removal would have joined (`<<b>p>`) goes too.
  let out = html;
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/<[^>]*>/g, "");
  }
  return out;
}

const normal = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

function holder(expected: string | RegExp) {
  return (s: string | null) => (typeof expected === "string" ? normal(s) === expected : expected.test(normal(s)));
}

export function textContent(expected: string | RegExp) {
  const holds = holder(expected);
  return (_content: string, el: Element | null): boolean =>
    el !== null && holds(el.textContent) && !Array.from(el.children).some((child) => holds(child.textContent));
}

/**
 * For a role query's `name`: `getByRole("heading", { name: wholeText("Its newest 2 H-2A, H-2B and CW-1 filings")
 * })`. The test DOM computes an accessible name with a space around every span, since it draws no span inline,
 * so "H-2A," reads "H-2A ,". A browser reads the heading as written. This matches the element's own whole text.
 */
export function wholeText(expected: string | RegExp) {
  const holds = holder(expected);
  return (_name: string, el: Element | null): boolean => el !== null && holds(el.textContent);
}
