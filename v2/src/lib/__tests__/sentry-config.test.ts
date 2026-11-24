import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SENTRY_DATA_COLLECTION } from "../sentryDataCollection";

/**
 * The Privacy Policy says Sentry receives no request body, cookie or visitor's address, and no shared recruitment
 * record's key (its page at /share/recruitment/<key> opens to anyone holding the key). Sentry 11 collects bodies,
 * cookies and addresses unless told not to, and sends spans in a new format, so these tests load the real server
 * config (sentry.server.config.ts) onto a real Sentry Node client whose transport keeps what would have been sent,
 * and read what was sent.
 */

const state = vi.hoisted(() => ({ sent: [] as string[], recordOnly: false }));

vi.mock("@sentry/nextjs", async () => {
  const node = await vi.importActual<typeof import("@sentry/node")>("@sentry/node");
  // Handlers that end the process on an uncaught error: they collect nothing, and here they'd end the test run.
  const processHandlers = new Set(["OnUncaughtException", "OnUnhandledRejection"]);
  return {
    ...node,
    httpIntegration: vi.fn(node.httpIntegration),
    init: vi.fn((options: Parameters<typeof node.init>[0]) => {
      if (state.recordOnly || !options) return undefined;
      return node.init({
        ...options,
        defaultIntegrations: node.getDefaultIntegrations(options).filter((i) => !processHandlers.has(i.name)),
        transport: (transportOptions) =>
          node.createTransport(transportOptions, async (request) => {
            state.sent.push(typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body));
            return { statusCode: 200 };
          }),
      });
    }),
  };
});

const KEY = "q7Zt0Lw_-3fXbV9kR2mN8pS1uY4eH6cJ0aD5gK7iO2s";
const PATH = `/share/recruitment/${KEY}`;
const SCRUBBED = "/share/recruitment/redacted";

type SentryMock = typeof import("@sentry/node") & { init: ReturnType<typeof vi.fn>; httpIntegration: ReturnType<typeof vi.fn> };
type InitOptions = Record<string, unknown> & {
  beforeSendSpan?: (span: Record<string, unknown>) => Record<string, unknown>;
};

/** The items of every envelope sent since the last reset, as [type, payload]. */
function sentItems(): Array<{ type: string; payload: Record<string, unknown> }> {
  const out: Array<{ type: string; payload: Record<string, unknown> }> = [];
  for (const body of state.sent) {
    const lines = body.split("\n").filter(Boolean);
    for (let i = 1; i + 1 < lines.length; i += 2) {
      out.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
    }
  }
  return out;
}

/** A streamed span as beforeSendSpan receives it, naming a shared record's page everywhere a span can. */
function streamedSpan(): Record<string, unknown> {
  return {
    trace_id: "a".repeat(32),
    span_id: "b".repeat(16),
    name: `GET ${PATH}`,
    start_timestamp: 1,
    end_timestamp: 2,
    status: "ok",
    is_segment: true,
    attributes: {
      "sentry.op": "http.server",
      "url.full": `https://permtracker.app${PATH}?_rsc=1`,
      "url.path": PATH,
      "sentry.segment.name": `GET ${PATH}`,
      "http.request.header.referer": [`https://permtracker.app${PATH}`],
    },
    links: [{ trace_id: "c".repeat(32), span_id: "d".repeat(16), attributes: { "url.full": `https://permtracker.app${PATH}` } }],
  };
}

describe("what Sentry may collect", () => {
  it("is Sentry 10's default: no user details, cookies, bodies, AI or database content, and no personal headers", () => {
    const personal = ["forwarded", "-ip", "remote-", "via", "-user"];
    expect(SENTRY_DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: personal }, response: { deny: personal } },
      httpBodies: [],
      urlQueryParams: { deny: personal },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      stackFrameVariables: false,
    });
  });
});

describe("the server's Sentry setup (sentry.server.config.ts)", () => {
  let Sentry: SentryMock;
  let options: InitOptions;
  let httpOptions: unknown[];
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.sentry.io/1");
    vi.stubEnv("SENTRY_ENVIRONMENT", "test");
    Sentry = (await import("@sentry/nextjs")) as unknown as SentryMock;
    // Read here: Vitest clears every mock's calls before each test. The calls this import makes are the ones after
    // `before`: the edge test may have run first (CI shuffles).
    const before = { init: Sentry.init.mock.calls.length, http: Sentry.httpIntegration.mock.calls.length };
    await import("../../../sentry.server.config");
    options = Sentry.init.mock.calls[before.init]![0] as InitOptions;
    httpOptions = Sentry.httpIntegration.mock.calls.slice(before.http).map((call) => call[0]);

    // Reads the body through "data" listeners, as Next does (the listeners Sentry would record a body from), and
    // awaits the end, so the error is captured in the request's own scope.
    server = createServer((req, res) => {
      void (async () => {
        await new Promise<void>((resolve) => {
          req.on("data", () => undefined);
          req.on("end", resolve);
        });
        Sentry.captureException(new Error("The sign-in failed"));
        res.end("ok");
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await Sentry.close(1000);
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    state.sent.length = 0;
  });

  it("passes the restrictive data collection setting, and the client runs on it", () => {
    expect(options.dataCollection).toBe(SENTRY_DATA_COLLECTION);
    const resolved = Sentry.getClient()!.getDataCollectionOptions();
    expect(resolved.httpBodies).toEqual([]);
    expect(resolved.userInfo).toBe(false);
    expect(resolved.cookies).toBe(false);
  });

  it("keeps request bodies out at the HTTP integration too, in Sentry 11's name for it", () => {
    expect(httpOptions).toEqual([{ disableIncomingRequestSpans: true, maxRequestBodySize: "none" }]);
    expect((options.integrations as Array<{ name: string }>).map((i) => i.name)).toEqual(["ConsoleLogs", "Http"]);
  });

  it("sends an error from a request with a body without the body, its cookies or the visitor's address", async () => {
    const body = JSON.stringify({ email: "jane@example.test", password: "correct horse battery staple" });
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest(
        `${origin}/api/auth/signin?next=%2Fcases`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: "session=abc123; theme=dark",
            "x-forwarded-for": "203.0.113.7",
            "user-agent": "test",
          },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end(body);
    });
    await Sentry.flush(2000);

    const events = sentItems().filter((i) => i.type === "event");
    expect(events).toHaveLength(1);
    const event = events[0]!.payload as { request?: Record<string, unknown>; user?: Record<string, unknown> };
    // The request is described (so the test isn't empty), and its body is not.
    expect(event.request?.url).toContain("/api/auth/signin");
    expect(event.request?.method).toBe("POST");
    expect(event.request).not.toHaveProperty("data");
    expect(event.request).not.toHaveProperty("cookies");
    expect(event.user?.ip_address).toBeUndefined();
    const text = state.sent.join("\n");
    for (const secret of ["jane@example.test", "correct horse", "abc123", "203.0.113.7"]) expect(text).not.toContain(secret);
  });

  it("sends a streamed span with a share key in its name and URL attributes scrubbed", async () => {
    Sentry.startSpan(
      { name: `GET ${PATH}`, attributes: { "url.full": `https://permtracker.app${PATH}?_rsc=1`, "url.path": PATH } },
      () => {
        Sentry.startSpan({ name: `read ${PATH}`, attributes: { "http.request.header.referer": [`https://permtracker.app${PATH}`] } }, () => undefined);
      },
    );
    await Sentry.flush(2000);

    const spans = sentItems()
      .filter((i) => i.type === "span")
      .flatMap((i) => (i.payload as { items: Array<{ name: string; attributes: Record<string, { value: unknown }> }> }).items);
    expect(spans.map((s) => s.name).sort()).toEqual([`GET ${SCRUBBED}`, `read ${SCRUBBED}`]);
    const page = spans.find((s) => s.name.startsWith("GET"))!;
    expect(page.attributes["url.full"]!.value).toBe(`https://permtracker.app${SCRUBBED}?_rsc=1`);
    expect(page.attributes["url.path"]!.value).toBe(SCRUBBED);
    expect(state.sent.join("\n")).not.toContain(KEY);
  });

  it("scrubs what Sentry writes after beforeSendSpan: a page span renamed after its child ended", async () => {
    Sentry.startSpanManual({ name: "GET" }, (page) => {
      Sentry.startSpan({ name: "read the record" }, () => undefined);
      page.updateName(`GET ${PATH}`);
      page.end();
    });
    await Sentry.flush(2000);

    expect(sentItems().some((i) => i.type === "span")).toBe(true);
    // The child's sentry.segment.name and the envelope's trace header both come from the renamed page span.
    expect(state.sent.join("\n")).toContain(SCRUBBED);
    expect(state.sent.join("\n")).not.toContain(KEY);
  });

  it("scrubs the format beforeSendSpan receives: name, attributes and links", () => {
    const span = options.beforeSendSpan!(streamedSpan());
    expect(JSON.stringify(span)).not.toContain(KEY);
    expect(span.name).toBe(`GET ${SCRUBBED}`);
  });

  it("turns logs on with the console integration alone, and scrubs them", async () => {
    expect(options).not.toHaveProperty("enableLogs");
    expect(options).not.toHaveProperty("beforeSendTransaction");
    expect(options.traceLifecycle).toBe("stream");
    console.warn(`couldn't read ${PATH}`);
    await Sentry.flush(2000);

    const logs = sentItems().filter((i) => i.type === "log");
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).toContain(SCRUBBED);
    expect(state.sent.join("\n")).not.toContain(KEY);
  });
});

describe("the edge runtime's Sentry setup (sentry.edge.config.ts)", () => {
  it("passes the same data collection setting, streams spans and scrubs them", async () => {
    // Records the options without starting a second client: the server's tests may run after this one.
    state.recordOnly = true;
    const Sentry = (await import("@sentry/nextjs")) as unknown as SentryMock;
    const before = Sentry.init.mock.calls.length;
    try {
      await import("../../../sentry.edge.config");
    } finally {
      state.recordOnly = false;
    }
    const options = Sentry.init.mock.calls[before]![0] as InitOptions;

    expect(options.dataCollection).toBe(SENTRY_DATA_COLLECTION);
    expect(options.traceLifecycle).toBe("stream");
    expect(options).not.toHaveProperty("enableLogs");
    expect(options).not.toHaveProperty("beforeSendTransaction");
    expect(JSON.stringify(options.beforeSendSpan!(streamedSpan()))).not.toContain(KEY);
  });
});
