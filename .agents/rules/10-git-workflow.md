# RULE 10: NIMR-SAV GIT WORKFLOW & AUTHORIZATION MODEL

## 1. Authoritative Lifecycle
All changes must strictly follow the gated transition pipeline:
1. **DISCOVERY**: Inspect repository baseline, working tree, and relevant code.
2. **IMPLEMENTATION**: Apply minimal targeted changes.
3. **LOCAL VERIFICATION**: Run targeted tests, regressions, and quality gates.
4. **PRE-COMMIT REPORT**: Produce structured report with diff summary.
5. **COMMIT AUTHORIZATION**: Await explicit user/reviewer authorization.
6. **COMMIT**: Execute clean, atomic git commit with descriptive message.
7. **POST-COMMIT VERIFICATION**: Verify commit SHA, ancestry, and status.
8. **PUSH AUTHORIZATION**: Await explicit push authorization.
9. **PUSH**: Push branch to remote `origin`.
10. **PR AUTHORIZATION**: Await explicit PR creation authorization.
11. **PR**: Open pull request with structured change description.
12. **REVIEW / CI**: Verify automated checks and review feedback.
13. **MERGE AUTHORIZATION**: Await explicit merge authorization.
14. **MERGE**: Merge approved pull request.
15. **POST-MERGE VERIFICATION**: Verify deployment and release integrity.

## 2. Separate Authorization Gates
- Passing tests != authorization to commit.
- Successful commit != authorization to push.
- Successful push != authorization to open PR or merge.
- Merged PR != authorization to deploy.

## 3. Strict Prohibitions Without Explicit Authorization
The following commands are strictly prohibited without written user authorization:
- `git reset --hard`
- `git clean -fd`
- `git push --force` or `git push --force-with-lease`
- Branch deletion (`git branch -D`, `git push origin --delete`)
- History rewriting or commit amending of published commits
- Merging branches or tags
- Deploying to production environments

## 4. No Casual Approvals
Phrases like "looks good", "all green", "ready", or "GO recommendation" do NOT constitute authorization for destructive or remote operations. Authorization must explicitly specify the action (e.g., "authorized to commit", "authorized to push").
