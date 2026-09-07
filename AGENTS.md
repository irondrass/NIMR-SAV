# NIMR-SAV — MASTER ENGINEERING CONTRACT

Welcome to the NIMR-SAV repository. All agentic AI software engineers (Antigravity and subagents) operating on this repository must strictly abide by this master engineering contract.

---

## 1. Scope Classification Before Any Mutation

Before reading or editing code for an assigned task, you MUST classify your scope into exactly one category:

1. **V23 LEGACY**: Root vanilla JavaScript PWA (`index.html`, `app.js`, `styles.css`, `js/*.js`, `tests/*.test.mjs`).
2. **V24 REACT**: React/TypeScript modern stack in `apps/nimr-sav-react/` (`src/`, `tests/`, `package.json`).
3. **SHARED / PARITY**: Cross-cutting contracts requiring dual-generation synchronization (e.g., Supabase schemas, status models, shared business rules).
4. **DEVEX / TOOLING**: Engineering harness, documentation, agent rules, developer scripts.

**Hard Rule**: Never assume the target generation. Never modify V23 Legacy and V24 React simultaneously unless the task explicitly demands cross-generation parity. DEVEX/tooling tasks must never alter functional application behavior.

---

## 2. Repository Safety & Dirty Worktree Preservation

Before modifying ANY file:
1. Identify repository root, current branch, HEAD SHA, and working tree status (`git status --short`).
2. Identify all pre-existing modified or untracked files.
3. **Preserve pre-existing changes byte-for-byte**: Never reset, clean, stash, checkout over, or overwrite work belonging to an ongoing user task or another branch.
4. If a file targeted by your task already has uncommitted changes from another task, **STOP** and report the collision before editing.

---

## 3. Main Protection & Branch Discipline

- Never implement changes directly on `main` unless the user has explicitly authorized direct `main` execution.
- Standard development must happen on a dedicated feature/fix branch or an isolated worktree (`git worktree add`).
- Do not create or switch branches unless authorized by the task instructions.

---

## 4. Minimal-Change Principle

- Make the smallest coherent change that satisfies the requirement.
- No unsolicited refactoring or "drive-by cleanups".
- Do not modify formatting, comments, or variable names in untouched functions.
- Protected files (e.g., `js/planning.js`, `js/business-rules-v2187.js`, `js/version.js`, `supabase-schema.sql`, `sw.js`) must remain byte-identical unless the task explicitly targets their domain.
- Do not modify generated, bundled, or compiled files unless explicitly required.

---

## 5. Pragmatic Test-Driven Discipline

For bug fixes:
1. **Reproduce**: Identify reproducing steps and evidence.
2. **Failing Test**: Add a targeted regression test demonstrating the defect before fixing, when technically feasible.
3. **Root Cause**: Locate the underlying defect; do not patch symptoms.
4. **Minimal Fix**: Implement the smallest safe correction.
5. **Verification**: Run targeted test -> broader regression suite -> typecheck/lint where applicable -> inspect diff.
6. Never weaken or delete existing assertions merely to make a test pass.

For DEVEX, documentation, or pure configuration tasks:
- Do not invent artificial application tests where they add no value.

---

## 6. Authorization Boundaries (The 5 Gates)

Operating in this repository requires respecting strict separation of powers:

1. **Test Gate**: Passing tests != authorization to commit.
2. **Commit Gate**: Pre-commit report required -> wait for explicit user/ChatGPT authorization -> commit.
3. **Push Gate**: Successful commit != authorization to push -> wait for explicit push authorization.
4. **PR / Merge Gate**: Successful push != authorization to open PR or merge -> wait for explicit PR/merge authorization.
5. **Deployment Gate**: Merged PR != authorization to deploy or mutate live production -> wait for explicit deployment authorization.

Casual approval phrases such as *"looks good"*, *"all green"*, or *"GO recommendation"* do NOT constitute authorization.

---

## 7. Supabase Production Safety

- **Local files vs. Live database**: Editing a SQL file or migration locally is NOT the same as applying it to Supabase.
- Without explicit live database authorization:
  - DO NOT run remote SQL mutations.
  - DO NOT apply remote migrations.
  - DO NOT alter live RLS policies.
  - DO NOT deploy Edge Functions (`supabase functions deploy`).
  - DO NOT alter live secrets, environment variables, or Auth configurations.
- Every task impacting Supabase must explicitly declare its impact:
  `SUPABASE IMPACT: NONE | LOCAL ONLY | LIVE READ-ONLY | LIVE MUTATION REQUIRED`.
  If `LIVE MUTATION REQUIRED`, STOP and await explicit authorization.

---

## 8. Evidence-Based Reporting

Claims must be backed by concrete evidence:
- Exact commands executed and their working directory.
- Exact exit codes, stdout summaries, and stderr outputs.
- File paths and byte counts / line counts.
- Full git diff summaries (`git diff --stat`, `git status --short`, `git diff --check`).
- Never claim a test or check passed if it was skipped or not executed.

---

## 9. Modular Rule Architecture

The specific operational rules governing this repository are located in `.agents/rules/`:
- `00-nimr-safety.md`: Core safety protocols and working tree hygiene.
- `10-git-workflow.md`: Authoritative Git lifecycle and gated transitions.
- `20-tdd.md`: Regression-first test discipline and defect verification.
- `30-supabase-safety.md`: Dual-boundary Supabase rules and live mutation guards.
- `40-quality-gates.md`: Application-specific test, typecheck, lint, and diff commands.
- `50-release-gates.md`: Pre-merge, post-merge, and release fingerprinting verification.

Specialized roles are defined in `.agents/agents/`:
- `nimr-planner`: Read-only architectural and diagnostic planning agent.
- `nimr-reviewer`: Independent, non-modifying code review and compliance agent.
