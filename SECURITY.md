# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| < 2.0   | No        |

## Reporting a vulnerability

If you find a security vulnerability in PERM Tracker, please report it privately.

**Don't open a public GitHub issue for a security vulnerability.**

Email **security@permtracker.app** instead, with:

- A description of the vulnerability
- Steps to reproduce it
- Its possible impact
- Any fix you'd suggest (optional)

You can expect:

- An acknowledgment within **48 hours**
- A status update within **7 days**
- A timeline for the fix, set by severity

## Scope

This policy covers:

- The PERM Tracker web application at [permtracker.app](https://permtracker.app)
- The Convex backend functions
- Sign-in and access control
- How data is handled and stored

## Out of scope

- Third-party services (Convex, Vercel, Resend, Google OAuth)
- Denial of service attacks
- Social engineering

## Data sensitivity

PERM Tracker handles immigration case data. It follows OWASP guidance, including:

- Server-side authentication on every API endpoint
- Input validation and sanitization
- Encryption in transit (HTTPS/TLS)
- Sessions that time out after inactivity
- Audit logs for sensitive operations
