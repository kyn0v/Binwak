---
name: thermo-nuclear-code-quality-review
scope: binwak
version: 0.1.0
description: "Run an extremely strict maintainability review for abstractions, giant files, branching/spaghetti growth, type boundaries, and architectural drift in changed code."
argument-hint: "[optional base branch, default: main]"
---

# Thermo-Nuclear Code Quality Review

Run a harsh maintainability-focused review of the branch diff.

## Scope

- Review only changed code from the selected diff.
- Focus on structural quality, not cosmetic nits.

## Review Bar

1. Be ambitious: prefer simplification that deletes complexity.
2. Flag diffs that push files from under 1k lines to over 1k lines without strong justification.
3. Flag spaghetti growth (new ad-hoc branches in unrelated flows).
4. Prefer direct, maintainable designs over brittle abstractions or wrappers.
5. Push for explicit type/boundary contracts; question cast-heavy or optionality-heavy changes.
6. Keep logic in canonical layers and reuse existing helpers.
7. Flag avoidable sequential orchestration or non-atomic update patterns when a cleaner structure is obvious.

## Primary Questions

- Is there a code-judo move that makes this dramatically simpler?
- Did this change add branching complexity where better abstraction is possible?
- Is logic living in the right layer/module?
- Did this diff add indirection without improving clarity?
- Did this change create maintainability debt even if behavior still works?

## Output Format

Return findings in priority order:

1. structural regressions
2. missed simplification opportunities
3. spaghetti / branching growth
4. type/boundary and abstraction issues
5. file-size decomposition risks

For each finding include: severity, file:line evidence, why it harms maintainability, and concrete remediation.

## Attribution

This skill is adapted from the Thermos plugin in `cursor/plugins` (commit `a5cda8b561bb6536e880481734199a568cb647f4`), licensed under MIT.
