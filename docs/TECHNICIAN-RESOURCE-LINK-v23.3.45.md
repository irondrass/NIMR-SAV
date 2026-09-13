# Technician resource link — v23.3.45

Date: 2026-09-13. Scope: **V23 LEGACY**.
Base: `290afaa8039f989b1a8a6f66f3c0b0a1d610d544` (main, v23.3.44).
Branch: `fix/technician-resource-link-v2344`.

## Problem and resulting behavior

An administrator could see a technician linked to an active workshop resource while the technician workspace displayed an unlinked-account message. The server membership contains the resource UUID; the local planning uses `planning_resources.local_id`. Treating these identifiers as interchangeable lost the link during sign-in.

Sign-in now resolves the member's resource through an authenticated read scoped to its workshop and server resource ID. The local profile and account diagnostics use the returned local planning ID. The original server UUID remains available in the membership. No matching by name or fallback to a stale cached assignment is introduced. Missing, inactive, deleted, foreign-workshop or equipment resources cannot grant technician task access. Other canonical roles do not require this lookup.

Functional changes are limited to `js/supabase-client.js` and `js/state.js`. Remaining runtime edits align the PWA version and asset queries to v23.3.45. The v23.3.44 VN workflows, planning engine and sync transport remain unchanged. Existing release seals are preserved; the new canonical-LF fingerprint is `95d3635433dc99c188dbb358ab5d52fda5e5faf915bb9189d979af1aa6cf3e68`.

## Verification before commit

Commands ran from the branch worktree. Log files are retained in the local private audit directory `audit-premiere-utilisation-2026-09-10` alongside the worktree, not published with customer data.

| Command | Exit | Result |
|---|---:|---|
| `node --test tests/technician_membership_resource_link.test.mjs` | 0 | 13 tests pass, including all ten other canonical roles |
| `node --test --test-concurrency=1 tests/technician_membership_resource_link.test.mjs tests/sec_secure_identity_onboarding_sec001.test.mjs tests/technician_resource_isolation_v231a_bis.test.mjs tests/planning_resource_assignment.test.mjs tests/planning_resources_conflicts.test.mjs tests/supabase_sync_integrity.test.mjs` | 0 | 18 TAP tests pass |
| `node tests/technician_membership_resource_link_browser.test.mjs` | 0 | Browser reproduces unlinked workspace with UUID, resolves it, displays own assigned task, denies another technician's task |
| `node tests/run-audit-release.mjs` | 0 | Functional invocation: 72 TAP tests pass; isolated DAG invocation: 1 TAP test file passes |
| `node --test tests/pwa_deploy_asset_version_consistency_cache001.test.mjs tests/pwa_cache_version_contract.test.mjs tests/release_fingerprint_portability.test.mjs` | 0 | All 3 test files pass |
| `node --test --test-concurrency=1 tests/vn_part_rbac_foundation.test.mjs tests/vn_part_003c_actions.test.mjs tests/vn_part_003b_ui_readonly.test.mjs tests/vn_part_002b_core_server.test.mjs` | 0 | 100 tests pass |
| `node --check js/state.js` and `node --check js/supabase-client.js` | 0 | Syntax valid |
| `git diff --check` | 0 | No whitespace errors |

Counts overlap between commands and are not additive unique coverage totals. The first VN run had 97 passes and 3 failures: a current-version assertion still expected v23.3.44, and two tests lacked TypeScript. The assertion now expects v23.3.45 without removing any checks. TypeScript 5.9.3, matching the existing lockfile, was copied from an existing local installation into ignored node_modules; no React source, package manifest, lockfile or Edge Function was changed. The complete four-file VN rerun passes 100/100.

All four repository browser harnesses actually ran in `run-audit-release.mjs` through `node --test --test-concurrency=1` and returned successful subtest status; the parent command exited 0:

| Harness | Result |
|---|---|
| `tests/audit_completion_browser.test.mjs` | PASS |
| `tests/mobile_offline_recovery.test.mjs` | PASS |
| `tests/mobile_orientation_keyboard.test.mjs` | PASS |
| `tests/mobile_pwa_resume.test.mjs` | PASS |

These are simulated Chromium device profiles with isolated fixtures, not physical-device or real Supabase acknowledgements. They do not replace live role-by-role field observation.

The unchanged DAG threshold is **median < 25 ms**. The final isolated invocation measured 1.3008 / 4.0120 / 7.5635 / 12.0613 ms for 10 / 30 / 60 / 100 lines. An earlier run during this resumption also passed (100 lines: 14.3820 ms). These are local measurements; no speed improvement is attributed to the identity correction. Historical measurements from the superseded v23.3.39 candidate do not describe this release.

## Live verification and remaining audit

The original minimal correction was already observed with an actual linked technician account on the earlier local candidate: the expected resource and assigned task appeared. This candidate was then rebased by porting only the targeted correction onto current main v23.3.44, preserving the intervening VN releases. Before publication, v23.3.45 is validated by the above automated tests; its post-deployment live verification remains to be recorded separately.

The field audit remains in progress. Existing observations from v23.3.39 must not be silently relabeled as observations of v23.3.45. The four new VN roles and any unavailable real accounts require explicit coverage reporting. No real task was started or completed to demonstrate the resource correction.

SUPABASE IMPACT: **LIVE READ-ONLY** (authenticated resource lookup).
SQL / RLS / EDGE / AUTH CONFIGURATION CHANGES: **NONE**.
SYNC-CONFLICT-OPS-001: **UNTOUCHED**.
BUILD: **NOT RUN** — V23 Legacy has no compile build; syntax, release, functional and browser checks are the applicable coverage above.
PDF PAGINATION: **NOT VERIFIED** — HTML previews do not establish native exported PDF pagination.

## Pre-commit scope

The user's subsequent instruction to correct the linked-resource defect grants the necessary local and online permissions. It supersedes the earlier validation-only mission for PR #65. That PR is now merged; this correction is a separate branch based on the latest main. Publication must retain the release checks and must be verified on the served application. No existing dirty user worktree is included in this change.
