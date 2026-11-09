/**
 * The mail Worker's email handler (workers/mail/worker.mjs) forwards every
 * message unless Convex's verdict is a clear hold: a slow, missing or failing
 * check, a failing AI and a message too big to read first all forward, so the
 * spam check can never keep a person's mail out of the inbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error: a plain ES module the Worker bundles; no type declarations.
import worker from '../../../workers/mail/worker.mjs';

const RAW = [
  'From: Seller <outreach@growthlinks.example>',
  'To: support@permtracker.app',
  'Subject: Guest posts',
  'Message-ID: <m1@growthlinks.example>',
  'Content-Type: text/plain',
  '',
  'We sell backlinks. WhatsApp us.',
  '',
].join('\r\n');

function message(size?: number) {
  const bytes = new TextEncoder().encode(RAW);
  const forwards: string[] = [];
  return {
    to: 'support@permtracker.app',
    from: 'outreach@growthlinks.example',
    headers: new Headers({ subject: 'Guest posts' }),
    rawSize: size ?? bytes.length,
    raw: new Response(bytes).body,
    forward: async (to: string) => {
      forwards.push(to);
    },
    forwards,
  };
}

const env = (ai?: unknown) => ({
  OWNER_EMAIL: 'owner@example.com',
  CONVEX_SITE: 'https://convex.example',
  KEYS: { get: async (k: string) => (k === 'inbound_key' ? 'inkey' : 'ownkey') },
  AI: ai,
});

const aiSpam = { run: async () => ({ response: { verdict: 'spam' } }) };
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

async function deliver(
  verdictReply: () => Response | Promise<Response>,
  opts: { ai?: unknown; size?: number } = { ai: aiSpam },
) {
  const ai = 'ai' in opts ? opts.ai : aiSpam;
  const size = opts.size;
  const stored: Array<Record<string, unknown>> = [];
  const asked: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/inbound-email/verdict')) {
      asked.push(JSON.parse(String(init.body)));
      return verdictReply();
    }
    if (url.endsWith('/inbound-email')) {
      stored.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const m = message(size);
  const waits: Promise<unknown>[] = [];
  await worker.email(m, env(ai), { waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return { forwards: m.forwards, asked, stored };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the mail Worker', () => {
  it('holds a message only on a clear hold, and stores it as held', async () => {
    const r = await deliver(json({ ok: true, action: 'hold', score: 6, reasons: ['sells links or SEO'] }));
    expect(r.forwards).toEqual([]);
    expect(r.asked[0]).toMatchObject({ from: 'outreach@growthlinks.example', ai: 'spam' });
    expect(r.stored[0]).toMatchObject({ held: true, forwarded: false, spamScore: 6, spamReasons: ['sells links or SEO'] });
  });

  it.each([
    ['Convex says forward', json({ ok: true, action: 'forward', score: 0, reasons: [] })],
    ['the verdict route is missing', json({ ok: false }, 404)],
    ['Convex throws', () => Promise.reject(new Error('down'))],
  ])('forwards when %s', async (_label, reply) => {
    const r = await deliver(reply);
    expect(r.forwards).toEqual(['owner@example.com']);
    expect(r.stored[0]).toMatchObject({ held: false, forwarded: true });
  });

  it('forwards when the AI fails or is absent, and still asks Convex', async () => {
    const failing = { run: async () => Promise.reject(new Error('5028: model deprecated')) };
    for (const ai of [failing, undefined]) {
      const r = await deliver(json({ ok: true, action: 'forward' }), { ai });
      expect(r.forwards).toEqual(['owner@example.com']);
      expect(r.asked).toHaveLength(1);
      expect(r.asked[0]!.ai).toBeUndefined();
    }
  });

  it('forwards a message too big to read first, unchecked', async () => {
    const r = await deliver(json({ ok: true, action: 'hold' }), { ai: aiSpam, size: 400_000 });
    expect(r.forwards).toEqual(['owner@example.com']);
    expect(r.asked).toHaveLength(0);
    expect(r.stored[0]).toMatchObject({ text: expect.stringContaining('backlinks') });
  });

  it('forwards when Convex never answers', async () => {
    vi.useFakeTimers();
    const pending = deliver(() => new Promise<Response>(() => {}));
    await vi.advanceTimersByTimeAsync(10_000);
    const r = await pending;
    expect(r.forwards).toEqual(['owner@example.com']);
  });
});

/** A delivery with every failure the Worker has to survive under the test's control. */
async function deliverWith(o: {
  verdict?: string;
  storeStatus?: number[];
  forwardFailures?: number;
  ai?: unknown;
  kvThrows?: boolean;
  to?: string;
  envelopeFrom?: string;
  headerFrom?: string;
}) {
  const stored: Array<Record<string, unknown>> = [];
  const storeStatus = [...(o.storeStatus ?? [200])];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/inbound-email/verdict')) return new Response(JSON.stringify({ ok: true, action: o.verdict ?? 'forward', score: 0, reasons: [] }));
    if (url.endsWith('/inbound-email')) {
      stored.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: storeStatus.length > 1 ? storeStatus.shift()! : storeStatus[0]! });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const m = message();
  if (o.to) m.to = o.to;
  if (o.envelopeFrom) m.from = o.envelopeFrom;
  if (o.headerFrom) m.headers.set('from', o.headerFrom);
  let failuresLeft = o.forwardFailures ?? 0;
  const attempts: string[] = [];
  m.forward = async (to: string) => {
    attempts.push(to);
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('upstream refused the forward');
    }
    m.forwards.push(to);
  };
  const e = env('ai' in o ? o.ai : aiSpam);
  if (o.kvThrows) e.KEYS = { get: async () => { throw new Error('KV unavailable'); } };
  const waits: Promise<unknown>[] = [];
  await worker.email(m, e, { waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return { forwards: m.forwards, attempts, stored };
}

describe('the mail Worker never loses a message quietly', () => {
  it('forwards a held message to the owner when it can\'t be stored', async () => {
    const r = await deliverWith({ verdict: 'hold', storeStatus: [500, 500] });
    expect(r.stored.length).toBeGreaterThanOrEqual(1);
    expect(r.forwards).toEqual(['owner@example.com']);
  });

  it('keeps a held message out of the inbox when the store takes it', async () => {
    const r = await deliverWith({ verdict: 'hold' });
    expect(r.stored[0]?.held).toBe(true);
    expect(r.forwards).toEqual([]);
  });

  it('tries a refused forward once more before giving up', async () => {
    const r = await deliverWith({ forwardFailures: 1 });
    expect(r.attempts).toHaveLength(2);
    expect(r.forwards).toEqual(['owner@example.com']);
    expect(r.stored[0]?.forwarded).toBe(true);
    expect(r.stored[0]?.forwardFailed).toBeUndefined();
  });

  it('records a forward that failed twice, so the morning report can count it', async () => {
    const r = await deliverWith({ forwardFailures: 2 });
    expect(r.forwards).toEqual([]);
    expect(r.stored[0]?.forwarded).toBe(false);
    expect(r.stored[0]?.forwardFailed).toBe(true);
  });

  it('records an AI check that failed, and still forwards', async () => {
    const r = await deliverWith({ ai: { run: async () => { throw new Error('5028 model retired'); } } });
    expect(r.forwards).toEqual(['owner@example.com']);
    expect(r.stored[0]?.aiFailed).toBe(true);
  });

  it('forwards when the key store is down', async () => {
    const r = await deliverWith({ kvThrows: true });
    expect(r.forwards).toEqual(['owner@example.com']);
  });

  it('reads our own mail by its From header, since the envelope sender is the bounce address', async () => {
    const r = await deliverWith({
      to: 'demo@permtracker.app',
      envelopeFrom: '010001-bounce@send.permtracker.app',
      headerFrom: 'PERM Tracker <notifications@permtracker.app>',
    });
    expect(r.forwards).toEqual([]);
  });
});
