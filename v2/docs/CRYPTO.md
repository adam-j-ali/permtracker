# Cryptographic security

> **Module:** `convex/lib/crypto.ts`
> **Last Updated:** 2026-01-03

The cryptographic utilities PERM Tracker v2 uses to generate secure tokens and encrypt OAuth credentials.

---

## What it does

The crypto module does two things:

1. Secure random strings, for OTPs and verification tokens
2. Token encryption, for storing OAuth refresh tokens securely

---

## 1. Secure random strings

### Algorithm

Uses `@oslojs/crypto/random` with the Web Crypto API (`crypto.getRandomValues()`) for cryptographically secure random number generation.

### Secure alphabet

```typescript
const SECURE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
```

**Design decisions:**
- 30 characters (excludes ambiguous: 0/O, 1/l/I)
- Uppercase only for user-friendly OTPs
- High entropy: 30^12 = 5.3 * 10^17 combinations for 12-char tokens

### Usage

```typescript
import { generateSecureOTP, generateRandomString, SECURE_ALPHABET } from './lib/crypto';

// Generate a 12-character OTP (default)
const otp = generateSecureOTP();  // e.g., "A2B3C4D5E6F7"

// Generate custom length token
const token = generateRandomString(16, SECURE_ALPHABET);

// Use custom alphabet
const numericPin = generateRandomString(6, "0123456789");
```

---

## 2. OAuth token encryption

OAuth refresh tokens are encrypted at rest using AES-256-GCM authenticated encryption.

### Algorithm

| Property | Value |
|----------|-------|
| Algorithm | AES-256-GCM |
| Key size | 256 bits (32 bytes) |
| IV size | 96 bits (12 bytes) |
| Auth tag | 128 bits (16 bytes) |
| Encoding | Base64 |

### Security properties

1. Authenticated encryption: GCM mode gives both confidentiality and integrity
2. Random IV: each encryption uses a fresh random IV (never reused)
3. Key isolation: the encryption key is stored apart from the encrypted data
4. Tamper detection: any change to the ciphertext makes decryption fail

### Ciphertext format

```
| IV (12 bytes) | Ciphertext | Auth Tag (16 bytes) |
|---------------|------------|---------------------|
```

The parts are joined in that order and Base64-encoded for storage.

---

## 3. Key generation

### Generating an encryption key

Run this command to generate a new 256-bit encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or using OpenSSL:

```bash
openssl rand -hex 32
```

**Example output:**
```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

### Environment configuration

Set the key in Convex environment variables:

```bash
# Convex Dashboard → Settings → Environment Variables
OAUTH_ENCRYPTION_KEY=a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

**Requirements:**
- Exactly 64 hexadecimal characters (32 bytes)
- Keep different keys for development vs production
- Never commit keys to source control

---

## 4. Error handling

### Encryption errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `OAUTH_ENCRYPTION_KEY environment variable is not set` | Missing env var | Add key to Convex dashboard |
| `OAUTH_ENCRYPTION_KEY must be 64 hex characters` | Wrong key format | Regenerate with correct length |

### Decryption errors

| Error | Cause | Resolution |
|-------|-------|------------|
| `OperationError` (Web Crypto) | Tampered ciphertext | Data integrity violation: re-encrypt |
| `OperationError` (Web Crypto) | Wrong key | Verify correct key is configured |
| Invalid base64 | Corrupted data | Re-encrypt the token |

### Handling decryption failures

```typescript
try {
  const token = await decryptToken(encryptedValue);
} catch (error) {
  // Decryption failed - token may be:
  // 1. Corrupted
  // 2. Encrypted with a different key
  // 3. Not encrypted at all (legacy)

  if (!isEncryptedToken(encryptedValue)) {
    // Legacy unencrypted token - migrate it
    return encryptAndStore(encryptedValue);
  }

  // Encrypted but failed - requires re-authentication
  throw new Error("OAuth token invalid - please reconnect");
}
```

---

## 5. Token migration

The `isEncryptedToken()` helper identifies encrypted vs legacy plain tokens:

```typescript
import { isEncryptedToken, encryptToken } from './lib/crypto';

// Check if migration needed
if (!isEncryptedToken(storedToken)) {
  // Legacy plain token - encrypt it
  const encrypted = await encryptToken(storedToken);
  await updateStoredToken(encrypted);
}
```

**How it tells them apart:**
- Encrypted tokens decode to at least 12 bytes (IV length)
- Plain tokens fail base64 decode or are too short

---

## 6. Handling keys and tokens

### Key management

1. Rotation: rotate keys once a year, or after a suspected compromise
2. Separation: use a different key for each environment (dev/staging/prod)
3. Access: give key access to production admins only
4. Backup: keep a backup in a secure vault (never in git)

### Implementation notes

1. Never log tokens, encrypted or decrypted
2. Memory: tokens are processed in memory only and never written to logs
3. Key derivation: consider HKDF if you derive several keys from a master key
4. IV uniqueness: guaranteed by `crypto.getRandomValues()`

---

## 7. API reference

### Functions

```typescript
// Generate secure OTP (12 chars)
function generateSecureOTP(): string

// Generate random string with custom length/alphabet
function generateRandomString(length: number, alphabet: string): string

// Encrypt a token (async)
function encryptToken(plaintext: string): Promise<string>

// Decrypt a token (async)
function decryptToken(ciphertext: string): Promise<string>

// Check if value is encrypted
function isEncryptedToken(value: string): boolean
```

### Constants

```typescript
// Secure alphabet for OTP generation (30 chars, no ambiguous)
const SECURE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
```

---

## 8. Testing

Crypto functions are tested in `convex/lib/__tests__/crypto.test.ts`.

Run tests:
```bash
pnpm test:run convex/lib/__tests__/crypto.test.ts
```

Test coverage includes:
- Random string generation entropy
- Encryption/decryption round-trip
- Key format validation
- Error handling for missing/invalid keys
- Token migration detection

---

## References

- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [AES-GCM Specification (NIST SP 800-38D)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [Oslo Crypto Library](https://oslo.js.org/)
