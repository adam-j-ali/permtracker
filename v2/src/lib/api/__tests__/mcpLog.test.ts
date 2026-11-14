import { describe, expect, it, vi } from "vitest";

import { logMcpError, logShapeMiss } from "../mcpLog";

/**
 * One uptime bot's malformed MCP probe was 529 of the web log's 705 lines on Oct 31 2026. A refusal that's the
 * client's own mistake is logged at most once an hour per kind, with a count of the ones held back; anything else
 * is logged every time.
 */
describe("logMcpError", () => {
  it("logs a client-side refusal once an hour, then says how many it held back", () => {
    const log = vi.fn();
    const t0 = 1_793_000_000_000;
    for (let i = 0; i < 5; i++) logMcpError("Unsupported protocol version: 2025-06-18", t0 + i * 60_000, log);
    expect(log).toHaveBeenCalledTimes(1);
    logMcpError("Unsupported protocol version: 2025-06-18", t0 + 3_600_001, log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]).toContain("(and 4 more like it in the last hour)");
  });

  it("logs every other error", () => {
    const log = vi.fn();
    for (let i = 0; i < 3; i++) logMcpError("tool get_case threw: database query deadline", 1_793_100_000_000 + i, log);
    expect(log).toHaveBeenCalledTimes(3);
  });
});

describe("an answer outside its published shape", () => {
  it("is said once an hour per tool, naming the tool and where it missed", () => {
    // Arrange
    const log = vi.fn();
    const t0 = 1_794_000_000_000;
    // Act: three misses on one tool inside the hour, one on another tool, then one after the hour.
    logShapeMiss("zz_tool_a", "caseNumber", t0, log);
    logShapeMiss("zz_tool_a", "caseNumber", t0 + 60_000, log);
    logShapeMiss("zz_tool_a", "status", t0 + 3_000_000, log);
    logShapeMiss("zz_tool_b", "month", t0 + 61_000, log);
    logShapeMiss("zz_tool_a", "caseNumber", t0 + 3_600_001, log);
    // Assert
    expect(log).toHaveBeenCalledTimes(3);
    expect(String(log.mock.calls[0]![1])).toBe("tool zz_tool_a answered outside its published shape at caseNumber");
    expect(String(log.mock.calls[1]![1])).toContain("zz_tool_b");
    expect(String(log.mock.calls[2]![1])).toContain("zz_tool_a");
  });
});

