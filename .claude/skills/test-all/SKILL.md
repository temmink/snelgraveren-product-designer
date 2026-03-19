---
name: test-all
description: Run the full test suite — PHPUnit (Docker), Jest, and Playwright E2E tests
disable-model-invocation: true
---

# Run Full Test Suite

Execute all three test runners for the Product Designer plugin.

## Test Runners (run sequentially)

### 1. Jest (JavaScript unit tests)
```bash
npm test
```
Expected: ~71 tests across stores and components.

### 2. PHPUnit (PHP unit tests via Docker)
```bash
docker compose exec wordpress bash -c "cd /var/www/html/wp-content/plugins/product-designer && vendor/bin/phpunit"
```
Expected: ~44 tests across repositories, security, pricing, exporters, API.

### 3. Playwright E2E (browser tests)
```bash
npm run test:e2e
```
Expected: ~9 tests for admin templates, customer design flow, export flow.
Requires Docker WordPress to be running on localhost:8080.

## Reporting

After all suites complete, report a summary table:

| Suite | Tests | Passed | Failed | Time |
|-------|-------|--------|--------|------|

If any suite fails, still run the remaining suites and report all results.

## Prerequisites

- Docker must be running (`docker compose up -d`)
- Node modules installed (`npm install`)
- PHP dependencies installed (composer)
