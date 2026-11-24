import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

/** Header, cookie and query names that name a person or their address: Sentry 10's own default list, dropped whole. */
const personal = (): string[] => ["forwarded", "-ip", "remote-", "via", "-user"];

/**
 * What Sentry may collect, passed to every Sentry.init (the Node server, the edge runtime and the browser).
 *
 * Sentry 11 collects more when this is left unset: request and response bodies, cookies, the visitor's IP address,
 * database query data and AI prompts. The Privacy Policy describes Sentry 10's default, so this is that default, spelled
 * out (Sentry's own "keep the v10 default" block), with MCP content and local variables also off. No request body is
 * ever collected: a sign-in's body holds an email address and a password. The Node server's HTTP integration says the
 * same with `maxRequestBodySize: "none"`, which wins over this setting if either is ever changed.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { deny: personal() }, response: { deny: personal() } },
  httpBodies: [],
  urlQueryParams: { deny: personal() },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
  stackFrameVariables: false,
};
