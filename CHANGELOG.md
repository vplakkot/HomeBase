# Changelog

## Unreleased

- Add a vercel whoami diagnostic step to the promote workflow, so an
  auth/scope problem with VERCEL_TOKEN surfaces its own clear error
  instead of being buried inside vercel promote's failure. (#15)
- Fix promote workflow failing with "User not found (404)" by passing
  --scope explicitly to vercel promote. (#13)
- Add GitHub Actions workflow that promotes the latest production build to
  the production domain only when a version tag (v*) is pushed, using the
  Vercel CLI. (#11)
- Update Definition of Done in CLAUDE.md to allow chore issues, not just
  Ready requirements and bugs. (#9)
- Add GitHub Actions workflow that runs on every pull request: type check,
  tests, build, and a check that CHANGELOG.md was updated. (#7)
- Add blank Next.js app skeleton: homepage shows "HomeBase," one passing
  test, no styling or features yet. (#3)
