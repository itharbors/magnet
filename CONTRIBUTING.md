# Contributing

## Local setup

1. Install Node.js 22.13 or newer.
2. Run `npm ci`.
3. Run `npm run check` before opening a pull request.

## Change expectations

- Preserve host independence: production code must not import Harbors Server internals.
- Add regression tests for behavior changes and security-sensitive path handling.
- Treat exported types, manifest rules, error codes, and package subpaths as public API.
- Update `CHANGELOG.md` for user-visible changes.
- Keep commits focused and use an imperative summary.

Pull requests must pass formatting, lint, type checking, coverage thresholds, cross-platform tests,
package linting, and the packed-consumer smoke test.
