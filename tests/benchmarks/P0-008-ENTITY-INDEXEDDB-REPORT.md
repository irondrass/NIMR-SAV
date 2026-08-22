# P0-008 Entity-level IndexedDB persistence benchmark

Generated: 2026-08-22T11:22:28.976Z

Node does not expose browser IndexedDB in this repository, so this benchmark uses the production entity partition/diff planner with a deterministic in-memory record-store adapter. It measures partitioning, record selection, ordering, hydration reconstruction, and exact record counts; it does not claim browser IndexedDB I/O latency. Each scale ran in a fresh child Node process.

| Cases / bookings | Initial persistence (ms) | Hydration (ms) | One-case writes | One-booking writes | No-change case / booking writes |
|---:|---:|---:|---:|---:|---:|
| 10,000 / 30,000 | 33.2703 | 3.0634 | 1 | 1 | 0 / 0 |
| 50,000 / 150,000 | 211.2048 | 12.5972 | 1 | 1 | 0 / 0 |
| 100,000 / 300,000 | 497.5453 | 27.2008 | 1 | 1 | 0 / 0 |

## 100k / 300k evidence

- Stored records: 100,000 cases, 300,000 bookings.
- One-case update: 0.2157 ms, 1 case record written.
- One-booking update: 0.0776 ms, 1 booking record written.
- No-change save: 0 case and 0 booking records written.
- One-case delete: 1 case record deleted; one-booking delete: 1 booking record deleted.
- Full 100k / 300k partitioning and hydration completed without `RangeError`.
- Correctness acceptance: PASS. Scalability acceptance: PASS.

## In-flight concurrency correctness

- Same-state case A -> B -> C: final durable VIN C; save #2 wrote 1 case record.
- Same-state booking A -> B: final durable start B; save #2 wrote 1 booking record.
- Structural add: durable count 1; save #2 wrote 1 case record.
- Structural delete: case durable true; booking durable true; save #2 deleted 1 case and 1 booking record.
- Audit append: durable order B -> A; save #2 wrote 1 audit record.
- Commit N clears N+1 markers: NO (PASS). Tracker N uses live post-plan lengths: NO (PASS).
- Concurrency acceptance: PASS.

## Regression evidence

- Pre-change ordinary suite: 18 failures / 85 tests.
- First post-change ordinary run: 19 failures / 85 tests.
- The only after-only failure, `quiet_save_notifications_v2231.test.mjs`, reproduced twice, was fixed, and passed individually afterward.
- In-flight fix validation enumerated the current sorted root inventory once: 23 failures / 92 tests; this larger inventory is not count-comparable with the established 85-test baseline.
- Twelve browser/CDP candidates were rerun individually twice and failed before application code during CDP startup, attachment, or domain enablement.
- Final new deterministic regression count: zero.
- Focused P0-008 entity-persistence test: PASS.
- P0-007 runtime-index regression: PASS.
- Canonical roles/statuses, planning dead-code cleanup, permission-driven UI, and quality-controller role tests: PASS.
- Supabase sync integrity and offline/local-data integrity tests: PASS.

## Architecture boundary

P0-008 removes global serialization from local large-state persistence. Existing cloud/sync snapshot and fingerprint behavior remains global and is explicitly deferred to P0-009. Durable outbox and `sync_metadata` stores, backup/external formats, and transient P0-007 runtime indexes are unchanged.
