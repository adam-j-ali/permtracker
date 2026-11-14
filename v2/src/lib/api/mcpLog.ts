/**
 * A request the SDK refuses as the client's own mistake (a protocol version or envelope it doesn't serve) was
 * already answered to that client with the reason. On Oct 31 2026 one uptime bot's malformed probe was 529 of the
 * web log's 705 lines in a day, so each such kind is logged at most once an hour, with how many were held back.
 * Anything else is logged every time.
 */
const CLIENT_SIDE = /^(Unsupported protocol version|Rejected inbound request|Era mismatch|Dropped inbound request)/;
const lastLogged = new Map<string, { at: number; held: number }>();
export function logMcpError(message: string, now = Date.now(), log: (...a: unknown[]) => void = console.error): void {
  const kind = CLIENT_SIDE.exec(message)?.[1];
  if (!kind) {
    log("[mcp]", message);
    return;
  }
  const seen = lastLogged.get(kind);
  if (seen && now - seen.at < 3_600_000) {
    seen.held += 1;
    return;
  }
  log("[mcp]", message, seen?.held ? `(and ${seen.held} more like it in the last hour)` : "");
  lastLogged.set(kind, { at: now, held: 0 });
}

const shapeLogged = new Map<string, number>();

/**
 * A tool's answer fell outside the shape the server publishes for it. The assistant still got the answer; this
 * is how we hear that a schema has drifted from what a read sends. Once an hour per tool: a drifted shape on a
 * busy tool is one line, not thousands.
 */
export function logShapeMiss(tool: string, where: string, now = Date.now(), log: (...a: unknown[]) => void = console.error): void {
  const last = shapeLogged.get(tool);
  if (last !== undefined && now - last < 3_600_000) return;
  shapeLogged.set(tool, now);
  log("[mcp]", `tool ${tool} answered outside its published shape at ${where}`);
}

