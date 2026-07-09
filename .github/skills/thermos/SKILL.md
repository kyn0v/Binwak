---
name: thermos
scope: binwak
version: 0.1.0
description: "Run a double review in parallel: deep bug/security audit plus strict code-quality audit, then synthesize a single prioritized verdict."
argument-hint: "[optional base branch, default: main]"
---

# Thermos

Orchestrate two independent review passes in parallel, then synthesize one deduplicated result.

## Dimensions

- **Deep review**: security, correctness, breakages, devex regressions, feature-gate leaks.
- **Code quality review**: maintainability, architecture, complexity growth, decomposition quality.

## Workflow

1. Determine review scope (`<base>...HEAD`, default `main`).
2. Gather diff plus changed-file contents for both reviewers.
3. Launch two parallel subagent reviews using the environment `task` tool:
   - one pass uses `.github/skills/thermo-nuclear-review/SKILL.md` rubric
   - one pass uses `.github/skills/thermo-nuclear-code-quality-review/SKILL.md` rubric
4. Wait for both responses, then synthesize:
   - findings first
   - deduplicate overlaps
   - weight shared findings higher
   - resolve disagreement with explicit judgment
5. Return unified verdict with highest-signal evidence first.

## Execution Guidance

- Prefer parallel subagents over sequential execution.
- Keep both passes diff-scoped; do not report untouched legacy issues.
- If PR comments are consulted, do so after independent audits complete.

## Attribution

This skill is adapted from the Thermos plugin in `cursor/plugins` (commit `a5cda8b561bb6536e880481734199a568cb647f4`), licensed under MIT.
See [NOTICE](./NOTICE).
