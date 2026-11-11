/**
 * Whether this page is drawn in a frame on one of our own pages, not opened as a page.
 *
 * The professionals' page shows a live embed as a firm's site would carry it (`FirmSiteSection`). The frame is our
 * own page on our own address, so it shared the visitor's session and recorded a page view of its own: in 14 days
 * "an embed" was the second most common next page after /for-attorneys (Nov 10 2026), which no visitor went to.
 * An embed on another site is a real view, and stays one: its parent's address can't be read from inside the frame.
 */
export function inOwnFrame(win: Pick<Window, "self" | "top" | "location"> = window): boolean {
  if (win.self === win.top) return false;
  try {
    return win.top !== null && win.top.location.origin === win.location.origin;
  } catch {
    // Another site holds the frame: reading its address is refused, and that's the answer.
    return false;
  }
}
