# Contributing

Thanks for your interest in improving `openapi-mcp-runtime`.

## Setup

```bash
git clone https://github.com/JAPofc/openapi-mcp-runtime.git
cd openapi-mcp-runtime
npm install
npm test
```

## Guidelines

- Keep the package dependency-light. Runtime dependencies are added only when
  there is no reasonable standard-library alternative.
- Every behavior change needs a test. The suite uses `node:test` and runs with
  `npm test`.
- Keep the public API stable. Additive changes are fine; breaking changes need a
  major version and a migration note.
- Do not commit `dist/` or `node_modules/`.

## Pull requests

1. Fork and create a branch from `main`.
2. Add or update tests for the change.
3. Run `npm test` and make sure it passes on Node 18, 20 and 22.
4. Open a pull request with a short description of the problem and the fix.

## Reporting bugs

Open an issue with:

- the spec (or a minimal reproduction) that triggers the problem,
- the command or code you ran,
- the expected and actual output,
- Node version and OS.
