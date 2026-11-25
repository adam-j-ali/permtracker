/**
 * The mail Worker (workers/mail/) decides what reaches the owner's inbox the
 * way the app did while Resend received the mail, and checks its keys and
 * owner messages before it sends anything.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module the Worker bundles; no type declarations.
import { capInbound, checkText, holdsIt, INBOUND_LIMITS, KEY_PATTERN, keyMatches, keyTag, ownerMessage, ownerRecipient, provisionOpen, shouldForward } from '../../../workers/mail/rules.mjs';
import { shouldForwardInbound } from '@convex/lib/supportEmailForward';

const OWNER = 'owner@example.com';

describe('shouldForward matches the app rule it replaces', () => {
  it.each([
    ['support@permtracker.app', 'person@example.com'],
    ['support@permtracker.app', 'PERM Tracker <notifications@permtracker.app>'],
    ['demo@permtracker.app', 'notifications@permtracker.app'],
    ['dmarc@permtracker.app', 'reports@google.com'],
    [OWNER, 'someone@example.com'],
    ['hello@permtracker.app', 'Someone <someone@example.com>'],
  ])('to %s from %s', (to, from) => {
    expect(shouldForward(to, OWNER, from)).toBe(shouldForwardInbound(to, OWNER, from));
  });
});

describe('keyMatches', () => {
  it('matches only the exact key, and nothing when unset', async () => {
    expect(await keyMatches('secret-key', 'secret-key')).toBe(true);
    expect(await keyMatches('secret-kex', 'secret-key')).toBe(false);
    expect(await keyMatches('', 'secret-key')).toBe(false);
    expect(await keyMatches('anything', undefined)).toBe(false);
  });
});

describe('ownerMessage', () => {
  it('takes a subject and text, strips line breaks from the subject', () => {
    expect(ownerMessage({ subject: 'Disk\nfull', text: 'x' })).toEqual({ subject: 'Disk full', text: 'x' });
  });
  it('refuses a missing subject or text, or too much', () => {
    expect(ownerMessage({ text: 'x' }).error).toBeTruthy();
    expect(ownerMessage({ subject: 's' }).error).toBeTruthy();
    expect(ownerMessage({ subject: 's'.repeat(301), text: 'x' }).error).toBeTruthy();
    expect(ownerMessage(null).error).toBeTruthy();
  });
  it('carries a reply-to and an inbox, and refuses anything that isn\'t one address', () => {
    expect(ownerMessage({ subject: 's', text: 'x', to: 'Me@Example.com', replyTo: 'person@example.org' })).toEqual({
      subject: 's', text: 'x', to: 'me@example.com', replyTo: 'person@example.org',
    });
    expect(ownerMessage({ subject: 's', text: 'x', replyTo: 'a@b.com, c@d.com' }).error).toBeTruthy();
    expect(ownerMessage({ subject: 's', text: 'x', to: 'Name <a@b.com>' }).error).toBeTruthy();
    expect(ownerMessage({ subject: 's', text: 'x', to: 7 }).error).toBeTruthy();
  });
});

describe('ownerRecipient', () => {
  it('sends to the main inbox when none is named', () => {
    expect(ownerRecipient(undefined, ' Owner@Example.com ')).toBe('owner@example.com');
  });
  it('allows the main inbox and the listed ones, and no other address', () => {
    expect(ownerRecipient('owner@example.com', OWNER)).toBe('owner@example.com');
    expect(ownerRecipient('second@example.org', OWNER, 'second@example.org, third@example.net')).toBe('second@example.org');
    expect(ownerRecipient('stranger@example.com', OWNER, 'second@example.org')).toBeNull();
    expect(ownerRecipient('second@example.org', OWNER)).toBeNull();
  });
});

describe('provisioned keys', () => {
  it('accept only 64 hex characters, and tag a key by its hash, never the key', async () => {
    expect(KEY_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(KEY_PATTERN.test('a'.repeat(63))).toBe(false);
    expect(KEY_PATTERN.test('A'.repeat(64))).toBe(false);
    const tag = await keyTag('a'.repeat(64));
    expect(tag).toMatch(/^[0-9a-f]{8}$/);
    expect('a'.repeat(64)).not.toContain(tag);
  });
});

describe('the provisioning window', () => {
  const now = Date.parse('2026-10-12T22:00:00Z');
  it('is shut unless an upload opened it, and never for more than an hour', () => {
    expect(provisionOpen(undefined, now)).toBe(false);
    expect(provisionOpen('', now)).toBe(false);
    expect(provisionOpen('not a date', now)).toBe(false);
    expect(provisionOpen('2026-10-12T21:59:00Z', now)).toBe(false); // passed
    expect(provisionOpen('2026-10-12T22:15:00Z', now)).toBe(true); // a rotation window
    expect(provisionOpen('2026-10-12T23:00:00Z', now)).toBe(true); // the hour itself
    expect(provisionOpen('2026-10-13T22:00:00Z', now)).toBe(false); // a day: too long to leave open
  });
});

describe('the spam check in the Worker', () => {
  it('holds only on a clear hold, so any fault forwards', () => {
    expect(holdsIt({ ok: true, action: 'hold', score: 5, reasons: [] })).toBe(true);
    expect(holdsIt({ ok: true, action: 'forward' })).toBe(false);
    expect(holdsIt({ ok: true, action: 'notice' })).toBe(false);
    expect(holdsIt({ ok: false, action: 'hold' })).toBe(false);
    expect(holdsIt(undefined)).toBe(false);
    expect(holdsIt(null)).toBe(false);
    expect(holdsIt({ action: 'hold' })).toBe(false);
  });

  it('reads the text part, or the HTML with its tags out and its links kept', () => {
    expect(checkText({ text: 'plain words', html: '<p>other</p>' })).toBe('plain words');
    const read = checkText({ html: '<style>p{}</style><p>Buy <a href="https://shop.example/x">now</a></p>' });
    expect(read).toContain('https://shop.example/x');
    expect(read).toContain('Buy');
    expect(read).not.toContain('<');
    expect(read).not.toContain('p{}');
    expect(checkText(null)).toBe('');
  });

  // A stranger's HTML-only message, shaped to make a backtracking regex run for seconds (Nov 19 2026 security review:
  // 10,000 characters of an unclosed link took 2 s, cubically, and the email handler ran out of CPU before the forward).
  it.each([
    ['an unclosed link, repeated', '<a href="x" '.repeat(5_000)],
    ['opening brackets only', '<'.repeat(250_000)],
    ['an unclosed style block, repeated', '<style'.repeat(40_000)],
  ])('reads %s in linear time', (_shape, html) => {
    const started = performance.now();
    checkText({ html });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('checks a hostile From header quickly, and still reads a normal one', () => {
    const started = performance.now();
    shouldForward('support@permtracker.app', 'owner@example.com', '<'.repeat(200_000));
    shouldForwardInbound('support@permtracker.app', 'owner@example.com', '<'.repeat(200_000));
    expect(performance.now() - started).toBeLessThan(200);
    expect(shouldForward('demo@permtracker.app', OWNER, 'PERM Tracker <notifications@permtracker.app>')).toBe(false);
    expect(shouldForwardInbound('demo@permtracker.app', OWNER, 'PERM Tracker <notifications@permtracker.app>')).toBe(false);
  });

  it('keeps a link that sits after a tag with no end on its own line', () => {
    const read = checkText({ html: '<p>Hi <a class="b" href="https://ok.example/y">there</a> <b>bold</b>' });
    expect(read).toContain('https://ok.example/y');
    expect(read).toContain('Hi');
    expect(read).toContain('bold');
  });
});

describe('capInbound: a stranger\'s subject and name are cut before any check reads them', () => {
  it('cuts a subject to the line length mail allows, and a name to 200 characters', () => {
    expect(INBOUND_LIMITS).toEqual({ subject: 998, name: 200 });
    expect(capInbound('x'.repeat(80_000), INBOUND_LIMITS.subject)).toHaveLength(998);
    expect(capInbound('n'.repeat(5_000), INBOUND_LIMITS.name)).toHaveLength(200);
  });
  it('folds line breaks into spaces and trims, so a subject is one line', () => {
    expect(capInbound('  Job\r\n request\n', 998)).toBe('Job request');
  });
  it('leaves an ordinary value alone and passes a missing one through', () => {
    expect(capInbound('Hello, I am sending this email requesting a job', 998)).toBe('Hello, I am sending this email requesting a job');
    expect(capInbound(undefined, 200)).toBeUndefined();
    expect(capInbound('', 200)).toBe('');
  });
});
