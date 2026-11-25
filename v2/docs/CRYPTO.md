# Cryptographic security

> **Module:** `convex/lib/crypto.ts`, and the other signing, hashing and token code listed in section 9
> **Last Updated:** 2026-11-25

How PERM Tracker makes random codes, encrypts the values it has to read back, and signs, hashes and checks tokens.
Everything here uses the Web Crypto API (`crypto.getRandomValues`, `crypto.subtle`), which runs in Convex's
runtime, in Node and in the browser. This page names environment variables. Their values never appear here.

---

## What `convex/lib/crypto.ts` does

The module does two things:

1. Random strings from a secure source, for the sign-in and password reset codes
2. AES-256-GCM encryption for three kinds of stored value the app must read back: Google Calendar OAuth tokens,
   a case's employer FEIN, and each webhook endpoint's signing secret

---

## 1. Secure random strings

### Algorithm

`generateRandomString` wraps `generateRandomString` from `@oslojs/crypto/random` (1.0.1) and feeds it bytes from
`crypto.getRandomValues()`. Oslo picks each character by rejection sampling, so every character of the alphabet is
equally likely.

### Secure alphabet

```typescript
export const SECURE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
```

- 31 characters: the digits 2 to 9 and the capital letters, leaving out 0, 1, I, L and O so a code can't be misread
- Capitals only
- A 12-character code has 31^12, about 7.9 * 10^17, possible values

The comments in `crypto.ts` and `convex/ResendOTP.ts` say 30 characters and 30^12 (5.3 * 10^17). The string itself
has 31.

### Where it's used

`generateSecureOTP()` returns 12 characters from `SECURE_ALPHABET`. It's the `generateVerificationToken` of both
Convex Auth email providers: `convex/ResendOTP.ts` (the sign-in and email verification code) and
`convex/ResendPasswordReset.ts` (the password reset code). Nothing else in the repository calls
`generateRandomString` directly.

```typescript
import { generateSecureOTP, generateRandomString, SECURE_ALPHABET } from "./lib/crypto";

const code = generateSecureOTP();                          // 12 characters, e.g. "A2B3C4D5E6F7"
const longer = generateRandomString(16, SECURE_ALPHABET);  // any length
const pin = generateRandomString(6, "0123456789");         // any alphabet
```

---

## 2. Encryption at rest

### What it protects

| Stored value | Written by | Read by |
|---|---|---|
| `userProfiles.googleAccessToken`, `googleRefreshToken` | `googleAuth.ts` (`storeGoogleTokens`, `storeGoogleTokensInternal`), `users.ts` (`updateUserProfile`) | `googleAuth.ts` (`getGoogleTokens`, `disconnectWithRevocation`) |
| `cases.employerFein` | `cases.ts` (`encryptFein` on create, update and import) | `cases.ts` (`decryptFein` in `list` and `get`), `dataExport.ts` |
| `webhookEndpoints.secretEnc` | `webhooks.ts` (`buildEndpoint`) | `webhookDelivery.ts` (to sign each delivery) |

One key, `OAUTH_ENCRYPTION_KEY`, encrypts all three.

### Algorithm

| Property | Value |
|----------|-------|
| Algorithm | AES-GCM (`crypto.subtle`), 256-bit key |
| Key | `OAUTH_ENCRYPTION_KEY`, 64 hex characters (32 bytes), imported as a raw key for encrypt and decrypt |
| IV | 12 bytes (96 bits), fresh from `crypto.getRandomValues()` for every encryption |
| Auth tag | 16 bytes (128 bits) |
| Plaintext | the string's UTF-8 bytes |
| Encoding | standard Base64 (`btoa`), with `+`, `/` and `=` padding |

GCM checks the tag on decryption. A value that was altered fails to decrypt, and so does one encrypted under another
key. Encrypting the same text twice gives two different values, because each one has its own IV.

### Ciphertext format

```
| IV (12 bytes) | Ciphertext | Auth tag (16 bytes) |
```

Web Crypto's `encrypt` returns the ciphertext with the tag on its end. To that, `encryptToken` adds the IV in front
and Base64-encodes the whole thing. Decrypting reverses it: the first 12 bytes are the IV, and the rest goes to
`crypto.subtle.decrypt`.

---

## 3. The key

### Making one

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or
openssl rand -hex 32
```

Either prints 64 hex characters. Set the result as `OAUTH_ENCRYPTION_KEY` in the Convex deployment's environment
variables (Settings, Environment Variables in the dashboard, or `npx convex env set`). The development and production
deployments each have their own.

### What the code checks

`getEncryptionKey()` checks that the variable is set and that it's exactly 64 characters long. It doesn't check that
those characters are hex: each pair is read with `parseInt(pair, 16)`, so a pair that isn't hex becomes 0 and the key
is quietly weaker.

### Changing the key

Nothing re-encrypts stored values. After a change, every value encrypted under the old key fails to decrypt:

- Google Calendar: `getGoogleTokens` logs the failure and returns `null` for that token, so the account has to
  reconnect.
- FEIN: `decryptFein` logs it and returns `undefined`, so the case shows an empty FEIN. The data export writes
  `[DECRYPTION_FAILED]` in its place.
- Webhooks: each delivery fails with "signing failed on our side". No function replaces an endpoint's secret, so the
  endpoint has to be deleted and made again.

---

## 4. Errors

### Encryption and decryption

| Error | Cause |
|-------|-------|
| `OAUTH_ENCRYPTION_KEY environment variable is not set` | The variable is missing or empty |
| `OAUTH_ENCRYPTION_KEY must be 64 hex characters (32 bytes)` | The variable isn't 64 characters long |
| `OperationError` from Web Crypto | Decryption with the wrong key, or a value that was altered |
| `InvalidCharacterError` from `atob` | Decrypting text that isn't Base64 |

`encryptToken` and `decryptToken` throw, and neither catches anything. `encryptFein` lets the error through on
purpose, so a missing key stops the write and no FEIN is ever stored as plain text.

### How callers handle a failed decryption

```typescript
// convex/cases.ts
async function decryptFein(fein: string | undefined): Promise<string | undefined> {
  if (!fein) return undefined;
  if (!isEncryptedToken(fein)) return fein; // Legacy plaintext
  try {
    return await decryptToken(fein);
  } catch {
    // Corrupted or key mismatch — log and return undefined so UI shows empty field
    console.error("[decryptFein] Failed to decrypt FEIN — key mismatch or data corruption");
    return undefined;
  }
}
```

For the Google tokens, `getGoogleTokens` in `googleAuth.ts` follows the same shape and returns `null` for a token
it can't decrypt. A webhook delivery whose secret won't decrypt is caught in `webhookDelivery.ts` and recorded as a
failure on our side.

One path differs. `disconnectWithRevocation` calls `decryptToken` on the stored access token without checking
`isEncryptedToken` first, and outside the `try` that guards the call to Google. A token it can't decrypt ends the
action with `success: false` before the stored tokens are cleared.

---

## 5. Values stored before encryption

Older rows can still hold a plain FEIN or a plain Google token. No migration rewrites them. Each reader tells the two
apart with `isEncryptedToken()` and uses a plain value as it is:

```typescript
export function isEncryptedToken(value: string): boolean {
  // Encrypted tokens are base64 and at least IV_LENGTH bytes when decoded
  try {
    const decoded = atob(value);
    return decoded.length >= IV_LENGTH;
  } catch {
    return false;
  }
}
```

It's a shape test. Any text that's valid Base64 and decodes to 12 bytes or more counts as encrypted, so a plain value
of 16 or more Base64 characters would be taken for ciphertext and fail to decrypt. A FEIN with its hyphen
(`12-3456789`) isn't Base64, and a 9-digit FEIN without one doesn't decode, so both read as plain.

---

## 6. Handling the key and the values

- The failure logs above record only that decryption failed. The structured logger (`convex/lib/logging.ts`) and the
  change log (`convex/lib/audit.ts`) each keep a `SENSITIVE_FIELDS` list (`googleAccessToken`, `googleRefreshToken`,
  `employerFein`, `token`, `secret`, `apiKey` and others) and write `[REDACTED]` for those fields.
- A decrypted value lives in memory for one function call. `cases.list` and `cases.get` hand the decrypted FEIN back
  to the case's owner, and nobody else. Decrypted Google tokens stay inside Convex. The public query
  `users.currentUserProfile` returns the whole profile row, which means the owner's browser receives the encrypted
  Google token values.
- The webhook signing secret is returned once, when the endpoint is made, and is never shown again. Settings shows
  only `secretHint`, its last four characters.

---

## 7. API reference

### Functions

```typescript
// 12 characters from SECURE_ALPHABET
function generateSecureOTP(): string

// Random string of any length from any alphabet
function generateRandomString(length: number, alphabet: string): string

// AES-256-GCM under OAUTH_ENCRYPTION_KEY; Base64 of IV + ciphertext + tag
function encryptToken(plaintext: string): Promise<string>

// The reverse; throws on a wrong key, altered data or bad Base64
function decryptToken(ciphertext: string): Promise<string>

// True when the value is Base64 that decodes to at least 12 bytes
function isEncryptedToken(value: string): boolean
```

### Constants

```typescript
// Exported
export const SECURE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// Module-private
const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const TAG_LENGTH = 16; // 128-bit authentication tag
```

---

## 8. Tests

`convex/lib/__tests__/crypto.test.ts`, in the `convex` vitest project:

```bash
pnpm test:run convex/lib/__tests__/crypto.test.ts
```

It covers:

- encrypt and decrypt round trips (a FEIN, an empty string, 1,000 characters, punctuation)
- a fresh IV each time, so the same text encrypts to two different values
- a missing key and a key of the wrong length, both refused
- decryption under a different key, refused
- `isEncryptedToken`: true for real ciphertext, false for a plain FEIN, short Base64, text that isn't Base64 and
  the empty string

Nothing tests `generateRandomString` or `generateSecureOTP`. Three other files exercise the module through its callers:
`convex/lib/__tests__/dataExport.test.ts` (the export's FEIN decryption and plain pass-through),
`convex/__tests__/googleTokens.test.ts` (stored Google tokens are encrypted and decrypt to what was sent) and
`convex/__tests__/webhooks.test.ts` (endpoint secrets).

---

## 9. Other cryptographic code

Each part below states what the code does. They share one rule: a secret that has to be checked later is stored as
a hash, and only a secret the app must use again (a token for Google, a webhook signing secret) is encrypted.

### API keys

Files: `convex/lib/apiKeyFormat.ts`, `convex/apiKeys.ts`, `src/lib/api/auth.ts`.

- Format: `pt_live_` (or `pt_test_` for a sandbox key), then 32 random base-62 characters and a 6-character
  checksum. That's 46 characters in all. The random characters come from `crypto.getRandomValues`. Bytes of 248 and
  over are skipped so each of the 62 characters is equally likely.
- Checksum: CRC-32 of the prefix and the 32 characters, written as 6 base-62 characters. It lets the site refuse a
  mistyped key without asking Convex. It's public, so it proves nothing about who made the key.
- Public id: the first 8 random characters, shown in Settings and stored with the usage counts.
- Stored: only `keyHash`, the SHA-256 of the whole key in lowercase hex, indexed `by_hash`. The `create` and `rotate`
  actions return the key once.
- Checked: `authenticate()` parses the key and its checksum, hashes it and looks the hash up with the public query
  `apiKeys.verify`, an exact match on the index. The answer is cached for 60 seconds. Keys Convex didn't recognise
  are cached apart (5,000 at most), and an address that sends 20 unknown keys in a minute is refused without a
  Convex call. Revoking or rotating a key clears the cached answer at once through `/api/revalidate-api-key`.
- The webhook and watch functions in `convex/webhooks.ts` take the key's hash as proof that the caller holds the key.

### Webhook signing

Files: `convex/lib/webhookSign.ts`, `convex/webhooks.ts`, `convex/webhookDelivery.ts`.

- Secret: `whsec_` plus 32 random bytes in Base64. It's encrypted with `encryptToken` (section 2) into
  `secretEnc`, with its last four characters in `secretHint`.
- Signature: Standard Webhooks. Each delivery carries `webhook-id` (`msg_<event id>`, the same on every retry),
  `webhook-timestamp` (Unix seconds) and `webhook-signature` (`v1,` plus Base64 of HMAC-SHA256 over
  `<id>.<timestamp>.<body>`). The HMAC key is the secret's Base64-decoded bytes after the `whsec_` prefix, so any
  Standard Webhooks library can check it. `signWebhook` throws on a secret without the prefix.
- Delivery: `https` only, port 443, a public host name, no credentials in the address, and never to
  `permtracker.app` or Convex's own hosts (`checkWebhookUrl`). `isPrivateAddress` refuses private, loopback,
  link-local, carrier NAT, multicast, reserved and documentation ranges, in IPv4 and IPv6. Redirects aren't
  followed.

Resend's own webhook to us is signed in the same family's format. `convex/http.ts` checks its `svix-id`,
`svix-timestamp` and `svix-signature` headers with the `svix` library's `Webhook.verify`, keyed by
`RESEND_WEBHOOK_SECRET`. A missing header or a bad signature gets 401. A missing secret gets 500.

### Action tokens in emails

File: `convex/lib/unsubscribeToken.ts`. Key: `UNSUBSCRIBE_SECRET`.

- Token: `<base64url(email)>.<base64url(HMAC-SHA256(message))>`. The email is trimmed and lowercased before
  signing. The message is `<purpose>:<email>`, or the bare email for the legacy unscoped form that weekly digest
  links already in inboxes still carry.
- Purposes: the confirm and unsubscribe links of each alert kind (queue, case, bulletin, employer), `prefs`,
  `digest-confirm`, `alert-rating`, `policy-accept:<version>` and the three reminder recipient purposes, which carry
  the recipient row's id.
- Verification recomputes the HMAC for the purpose the route expects and compares the two Base64url strings with
  `safeEqual`: a length check, then an XOR over every character with no early exit. A token made for one purpose
  never verifies for another, and a scoped token never verifies on the unscoped route.
- These tokens don't expire. Anyone holding the email can use the link again.
- `keyedHash(message, secret)` is the same HMAC, Base64url. `convex/lib/reminderRecipients.ts` uses it to store a
  reminder recipient's address as `HMAC(reminder-address-key:<canonical address>)` so it can be found again
  without being kept.

### Links that expire

File: `convex/lib/expiringToken.ts`. Key: `UNSUBSCRIBE_SECRET`.

- Used for the firm page claim: `firm-confirm` links last 7 days, `firm-edit` links 2 days (`convex/firmClaims.ts`).
- Token: `<base64url(email)>.<expiresAtMs>.<base64url(HMAC-SHA256("x:<purpose>:<expiresAtMs>:<email>"))>`. The
  expiry sits inside the signed message, so it can't be changed without breaking the signature. Three parts and the
  `x:` prefix mean an action token never verifies as one of these, or the other way round.
- Verification first refuses a malformed token: over 1,024 characters, a time that isn't 10 to 16 digits, or an
  address over 320 characters or without `@`. It refuses a token whose time has come. Then it compares the
  signature with the same `safeEqual`.
- HMAC needs no randomness, so these are made inside mutations.

### Sealed addresses in review links

File: `convex/lib/sealedEmail.ts`. Key material: `UNSUBSCRIBE_SECRET`.

- The review form's link carries the reviewer's address encrypted, so it never shows in a page address, a log or an
  analytics tool.
- Key: SHA-256 of `permtracker:review-link:v1`, a zero byte, then the secret, imported as an AES-GCM key.
- Token: base64url of a 12-byte random IV followed by the AES-GCM output of the JSON `{"e": email, "x": expiresAt}`.
  Links last 120 days (`REVIEW_LINK_TTL_MS`).
- `openEmail` returns `null` for a token under 40 or over 600 characters, one that fails to decrypt, and one past
  its time.

### Random keys stored as their SHA-256

Each of these keys is random and goes to one browser or one person. Only its SHA-256, in lowercase hex, is stored.
The database can't give a key back.

| Key | Made by | Size | Lookup |
|---|---|---|---|
| Recruitment share link (`convex/lib/shareToken.ts`) | `recruitmentShares.ts` action | 32 bytes, base64url (43 characters) | `tokenHash` |
| Review note token (`convex/lib/reviewNoteKey.ts`) | `/review/submit` in `http.ts` | 32 bytes, base64url | `noteKeys`, up to 3 per review |
| Turnstile pass (`convex/lib/turnstilePass.ts`) | `turnstile.ts` action, after Cloudflare accepts the check | 32 bytes, hex (64 characters) | `hash`, indexed `by_hash`, good for 10 minutes and deleted when used |
| Community timeline and consulate report edit keys | the browser | as sent | `sha256Hex("timeline-key:<key>")`, `sha256Hex("consular-key:<key>")` in `http.ts` |
| Browser push subscription endpoint | the browser | as sent | `sha256Hex(endpoint)` in `http.ts` |

The turnstile pass is required to create a password account, to ask for a password reset code, and to ask for a new
verification code.

### Visitor address hashes

File: `convex/lib/ipHash.ts`. Key: `IP_HASH_SECRET`.

- `ipHash(scope, ip)` is HMAC-SHA256 of `<scope>:<ip>` in hex. Scopes in use: `timeline`, `consular` and `push`.
- Without the secret it falls back to a plain SHA-256 of the same text and logs a warning once. A hash made each
  way is a different value.

### Shared secrets on server routes

- `src/lib/secretMatch.ts`: `secretMatches(given, expected)` and `bearerMatches(header, secret)`. Both values are
  hashed with SHA-256 and the two digests compared byte by byte with no early exit, so neither the secret's length
  nor a matching prefix shows in the timing. An unset or empty secret refuses everything. Used by the
  `/api/revalidate-*` routes (`REVALIDATE_SECRET`), `/api/sentry-check` (`SENTRY_CHECK_SECRET`) and the
  `/api/cron/*` routes (`Authorization: Bearer` with `CRON_SECRET`).
- `convex/watchedCases.ts`: `sharedSecretOk(given, want)` does the same and answers `ok`, `denied` or `off` (unset).
  Used for `WATCHED_CASES_SECRET` and, in `convex/http.ts`, `INBOUND_EMAIL_SECRET` (the `x-inbound-key` header).

### Unkeyed SHA-256 of an address

A few tables key rows by a plain SHA-256 of an email address, hex, with no secret:

- `consentKey` in `convex/lib/policyConsentStore.ts` and `raterKeyFor` in `convex/siteReviews.ts`: the address
  trimmed and lowercased.
- `ratingKey` in `convex/alertRatings.ts`: `<email>|<case number>`.
- `redactEmails` in `convex/lib/redactEmails.ts` swaps each address in text sent to Sentry for `email#` and the first
  six hex digits of the SHA-256 of the lowercased address.

Anyone who has a candidate address can compute these hashes and match them.

### Environment variables

| Name | Used for |
|---|---|
| `OAUTH_ENCRYPTION_KEY` | AES-256-GCM key: Google tokens, FEIN, webhook secrets |
| `UNSUBSCRIBE_SECRET` | Action tokens, expiring links, sealed review addresses, reminder address keys |
| `IP_HASH_SECRET` | Visitor address HMAC |
| `RESEND_WEBHOOK_SECRET` | Checking Resend's signed inbound webhook |
| `REVALIDATE_SECRET`, `SENTRY_CHECK_SECRET`, `CRON_SECRET` | Site route handlers called by server jobs |
| `WATCHED_CASES_SECRET`, `INBOUND_EMAIL_SECRET` | Convex HTTP routes called by server jobs |

### Tests for this section

`convex/lib/apiKeyFormat.test.ts`, `src/lib/api/__tests__/auth.test.ts`, `convex/__tests__/apiKeys.test.ts`,
`convex/lib/webhookSign.test.ts`, `convex/lib/__tests__/unsubscribeToken.test.ts`, `convex/__tests__/firmClaims.test.ts`
(expiring links), `convex/lib/sealedEmail.test.ts`, `convex/__tests__/recruitmentShares.test.ts`,
`convex/__tests__/turnstilePass.test.ts`, `convex/lib/__tests__/ipHash.test.ts` and
`src/lib/__tests__/secretMatch.test.ts`.

---

## References

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [AES-GCM (NIST SP 800-38D)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Oslo crypto library](https://crypto.oslojs.dev)
- [Standard Webhooks](https://www.standardwebhooks.com)
