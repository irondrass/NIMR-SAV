# P0-008 Entity-level IndexedDB persistence benchmark

Generated: 2026-08-22T09:37:11.932Z

Node does not expose browser IndexedDB in this repository, so this benchmark uses the production entity partition/diff planner with a deterministic in-memory record-store adapter. It measures partitioning, record selection, ordering, hydration reconstruction, and exact record counts; it does not claim browser IndexedDB I/O latency. Each scale ran in a fresh child Node process.

| Cases / bookings | Initial persistence (ms) | Hydration (ms) | One-case writes | One-booking writes | No-change case / booking writes |
|---:|---:|---:|---:|---:|---:|
| 10,000 / 30,000 | 30.1369 | 3.0747 | 1 | 1 | 0 / 0 |
| 50,000 / 150,000 | 233.1263 | 12.9307 | 1 | 1 | 0 / 0 |
| 100,000 / 300,000 | 505.6105 | 29.8485 | 1 | 1 | 0 / 0 |

## 100k / 300k evidence

- Stored records: 100,000 cases, 300,000 bookings.
- One-case update: 0.1680 ms, 1 case record written.
- One-booking update: 0.0477 ms, 1 booking record written.
- No-change save: 0 case and 0 booking records written.
- One-case delete: 1 case record deleted; one-booking delete: 1 booking record deleted.
- Full 100k / 300k partitioning and hydration completed without `RangeError`.
- Correctness acceptance: PASS. Scalability acceptance: PASS.

## Regression evidence

- Pre-change ordinary suite: 18 failures / 85 tests.
- First post-change ordinary run: 19 failures / 85 tests.
- The only after-only failure, `quiet_save_notifications_v2231.test.mjs`, reproduced twice, was fixed, and passed individually afterward.
- Final new deterministic regression count: zero.
- Focused P0-008 entity-persistence test: PASS.
- P0-007 runtime-index regression: PASS.
- Canonical roles/statuses, planning dead-code cleanup, permission-driven UI, and quality-controller role tests: PASS.
- Supabase sync integrity and offline/local-data integrity tests: PASS.

## Architecture boundary

P0-008 removes global serialization from local large-state persistence. Existing cloud/sync snapshot and fingerprint behavior remains global and is explicitly deferred to P0-009. Durable outbox and `sync_metadata` stores, backup/external formats, and transient P0-007 runtime indexes are unchanged.
