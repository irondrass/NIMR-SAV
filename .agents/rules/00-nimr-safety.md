# RULE 00: NIMR-SAV CORE SAFETY & WORKING-TREE HYGIENE

## 1. Mandatory Baseline Inspection Before Mutation
Before modifying any file, the agent MUST run:
- `git rev-parse --show-toplevel`
- `git branch --show-current`
- `git rev-parse HEAD`
- `git status --short`

## 2. Scope Classification
Every task must explicitly declare its scope before touching code:
- **V23 LEGACY**: Vanilla JS PWA at root (`app.js`, `index.html`, `styles.css`, `js/`, `tests/`).
- **V24 REACT**: React 18 / TypeScript application in `apps/nimr-sav-react/`.
- **SHARED / PARITY**: Cross-generation alignment (Supabase schemas, status constants, parity tests).
- **DEVEX / TOOLING**: Engineering harness, documentation, developer scripts.

Never modify V23 and V24 simultaneously unless cross-generation parity is explicitly requested. DEVEX/tooling tasks must never alter functional application behavior.

## 3. Preservation of Pre-existing Work
- Inspect `git status --short` before making changes.
- Any modified or untracked files already present are **PRE-EXISTING WORKTREE CHANGES**.
- Never execute `git reset`, `git checkout --`, `git restore`, `git clean`, or `git stash` over pre-existing work.
- If an assigned task targets a file that already has uncommitted modifications, STOP and report the conflict before editing.

## 4. Main Branch Protection
- Never implement changes directly on `main` unless explicitly instructed by the user.
- All development must occur on dedicated branches or isolated worktrees (`git worktree add`).

## 5. Minimal-Change Principle & Protected Files
- Make the minimal coherent edit to satisfy the requirement.
- No unsolicited refactoring, reformatting, or "cleanup".
- The following files are **PROTECTED** and require explicit justification to touch:
  - `js/planning.js`
  - `js/business-rules-v2187.js`
  - `js/supabase-sync.js`
  - `supabase-schema.sql`
  - `sw.js`
  - `js/version.js`
