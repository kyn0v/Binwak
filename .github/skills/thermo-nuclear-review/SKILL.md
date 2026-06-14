---
name: thermo-nuclear-review
description: "Comprehensive security and correctness audit of branch diffs. Use for thermo review, thermonuclear review, deep PR audit, bug risk checks, breaking-change checks, devex regressions, and feature-gate leak detection."
argument-hint: "[optional base branch, default: main]"
---

# Thermo Nuclear Review

Run a strict security and correctness review for changed code only.

## Scope

- Review only code that is added or modified in the target diff.
- Do not report issues that exist only in untouched code.

## Review Procedure

1. Identify review scope (`<base>...HEAD`, default base `main`).
2. Inspect diff and related changed-file contents end-to-end.
3. Audit for:
   - bugs and breakages across module boundaries
   - security vulnerabilities
   - developer-experience breakages (run/build/env changes)
   - accidental feature-gate leaks
4. Calibrate severity strictly; avoid over-reporting.
5. If medium/high findings exist and a PR is available, check PR discussion (`gh`) after your independent audit, then dedupe/attribute external findings.

## Critical Rules

- Never report with unfinished research when code is available to verify.
- Complete independent audit first; only then read PR discussion.
- Prioritize high-confidence findings with concrete file/line evidence.

## Output Format

Return findings in priority order:

1. `severity` (`high|medium|low`)
2. `title`
3. `evidence` (file:line + short explanation)
4. `impact`
5. `suggested fix`

If no meaningful issues are found, state that clearly.

## Attribution

This skill is adapted from the Thermos plugin in `cursor/plugins` (commit `a5cda8b561bb6536e880481734199a568cb647f4`), licensed under MIT.
