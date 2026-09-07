# RULE 20: NIMR-SAV TEST-DRIVEN & REGRESSION DISCIPLINE

## 1. Bug Fix Discipline
When fixing any reproducible defect:
1. **Reproduce**: Capture exact reproducing inputs and faulty behavior.
2. **Failing Regression Test**: Add a targeted test case asserting the expected behavior. Run it and demonstrate pre-fix failure when technically feasible.
3. **Root-Cause Analysis**: Identify the architectural flaw, not merely the surface symptom.
4. **Minimal Fix**: Implement the smallest safe code change to resolve the root cause.
5. **Targeted Verification**: Run the new regression test and verify it passes.
6. **Broader Regression Suite**: Run relevant domain regression suites (e.g., planning, identity, DAG, sync).
7. **Quality Gates**: Run typecheck, lint, and `git diff --check` where applicable.
8. **Integrity Guard**: Never weaken, disable, or delete existing test assertions to make a test pass.

## 2. Feature Implementation Discipline
1. Establish concrete acceptance criteria.
2. Identify affected domains (V23, V24, or Shared).
3. Locate existing test coverage in `tests/` or `apps/nimr-sav-react/tests/`.
4. Add tests for new capabilities before or alongside implementation.
5. Implement incrementally with intermediate verification.
6. Run full domain regression suite before pre-commit reporting.

## 3. Pragmatic Application to DEVEX / Docs
- Do not create mock or artificial application tests for pure documentation, rule changes, or developer harness updates.
- Test suites must validate actual application logic, not synthetic harness artifacts.
