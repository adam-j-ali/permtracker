/**
 * A push to the owner's phone (ntfy), sent beside an alarm's email and never instead of it.
 *
 * The same rule as the server's scripts/oracle/lib/phone_push.py, held to the same cases
 * (scripts/fixtures/phone_push_cases.json): one template (what happened, since when in Eastern time,
 * what to do), sent once when an alarm starts and once when it clears, and never carrying an IP
 * address, an email address or a receipt-shaped number. The topic is the NTFY_TOPIC env var.
 */

export const NTFY_URL = "https://ntfy.sh/";
export type PushLevel = "urgent" | "high" | "clear";

const PRIORITY: Record<PushLevel, string> = { urgent: "urgent", high: "high", clear: "default" };

// Simple tokens, each judged in code, so no pattern can backtrack on a long input; and a cap on the text first.
const MAX_TEXT = 2000;
const RECEIPT = /\b[A-Za-z]{3}\*?\d{9,}\b/g;
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
const AT = /[\w.+-]+@[\w.-]+/g;
const HEX = /[0-9A-Fa-f:]{3,}/g;
const RANGE = /an address\/\d{1,3}\b/g; // a range's /24 goes with its address
const HEX_GROUP = /^[0-9A-Fa-f]{1,4}$/;
// A systemd unit (permtracker-web@1.service) has an @ and a dot too, and is no address.
const UNIT_SUFFIXES = new Set(["service", "timer", "socket", "target", "mount", "path"]);

function email(word: string): string {
  const core = word.replace(/\.+$/, "");
  const domain = core.slice(core.indexOf("@") + 1);
  const top = domain.includes(".") ? domain.slice(domain.lastIndexOf(".") + 1) : "";
  return top.length >= 2 && /^[A-Za-z]+$/.test(top) && !UNIT_SUFFIXES.has(top.toLowerCase())
    ? "an email address" + word.slice(core.length)
    : word;
}

function ipv6(word: string): string {
  const addr = word;
  const groups = addr.split(":");
  if (addr.split("::").length > 2 || groups.length > 8 || addr.includes(":::")) return word;
  const filled = groups.filter((g) => g !== "");
  if (!filled.every((g) => HEX_GROUP.test(g))) return word;
  // Four or more groups, or a "::" shortening; a clock time (12:05:30) has three and no "::".
  return (addr.includes("::") && filled.length > 0) || groups.length >= 4 ? "an address" : word;
}

/** The text with every email address, receipt-shaped number and IP address replaced by a plain word. */
export function scrub(text: string): string {
  return String(text)
    .slice(0, MAX_TEXT)
    .replace(AT, email)
    .replace(RECEIPT, "a receipt number")
    .replace(IPV4, "an address")
    .replace(HEX, ipv6)
    .replace(RANGE, "an address");
}

/** A time as Eastern 12-hour time with its weekday, e.g. "Mon Nov 30, 8:00 AM EST". */
export function stamp(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).formatToParts(new Date(ms))) {
    p[part.type] = part.value;
  }
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

/** The push for an alarm that started: what, since when, what to do. */
export function started(what: string, sinceMs: number, todo: string): string {
  return scrub(`${what} Since ${stamp(sinceMs)}. ${todo}`.trim());
}

/** The push for an alarm that cleared: what is fine again, and when it had started. */
export function cleared(what: string, sinceMs: number): string {
  return scrub(`${what}. It had started ${stamp(sinceMs)}.`);
}

/** One push. ok when ntfy took it; otherwise why, for the log (the email carries the same news). */
export async function pushPhone(
  title: string, message: string, level: PushLevel, topic: string | undefined,
): Promise<{ ok: boolean; why: string }> {
  if (!topic || !/^[A-Za-z0-9_-]{8,64}$/.test(topic)) return { ok: false, why: "no usable NTFY_TOPIC" };
  try {
    const res = await fetch(NTFY_URL + topic, {
      method: "POST",
      body: scrub(message),
      headers: {
        Title: scrub(title),
        Priority: PRIORITY[level],
        Tags: level === "clear" ? "white_check_mark" : "warning",
      },
    });
    return res.ok ? { ok: true, why: "" } : { ok: false, why: `ntfy answered ${res.status}` };
  } catch (e) {
    return { ok: false, why: `ntfy unreachable (${e instanceof Error ? e.name : "error"})` };
  }
}
