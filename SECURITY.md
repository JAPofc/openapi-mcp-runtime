# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |
| < 0.1.0 | No |

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

Report privately at:
https://github.com/JAPofc/openapi-mcp-runtime/security/advisories/new

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation as
soon as practical. For sensitive follow-ups, continue the conversation inside the
private advisory.

## Scope and notes

`openapi-mcp-runtime` is a proxy: it reads a user-supplied OpenAPI document and
calls the APIs described in it.

- Credentials are provided by the operator and never leave the process except
  in requests to the target API. OAuth2 tokens are cached in memory until expiry.
- Treat OpenAPI documents, credentials, and generated logs as sensitive data.
- A malicious or compromised spec can cause the server to call arbitrary
  endpoints permitted by its credentials; only point it at APIs you trust.

## Hardening tips for operators

- Run the server with the least-privilege credentials available.
- Use `--transport http --host 127.0.0.1` unless remote access is required.
- Keep Node.js and dependencies up to date (`npm audit`, Dependabot).
