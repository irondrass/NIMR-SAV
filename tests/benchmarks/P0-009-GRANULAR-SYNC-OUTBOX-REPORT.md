# P0-009 Granular sync/outbox benchmark

Generated: 2026-08-23T16:04:11.624Z

This deterministic benchmark uses the production mutation capture, operation-envelope, coalescing, acknowledgement, dependency ordering, and cursor-page logic with an in-memory Supabase recording adapter. It makes no network calls and does not benchmark manual full backup.

## Bounded case mutation coverage

- 45 production case-mutation workflow groups were inventoried.
- Before the coverage fix, the real imported-labor allocation path reproduced the inactive-case defect: with A active, B remained at `localRevision = 0` instead of incrementing.
- After the fix, inactive B increments from revision 0 to 1 exactly once while A and C remain unchanged.
- B is the only case written by P0-008 entity persistence, survives an IndexedDB reload without cloud access, and creates exactly one durable `case` / `upsert` operation.
- A production multi-case planning migration persists inactive B and C through exact `changedCaseIds` without a full case scan.
- With 100 cases, changing one nominated inactive case writes only that case; the comparison remains a constant two candidates because active A is deliberately retained.
- Ordinary one-case saves use bounded candidates. Only true full backup import/replacement explicitly requests `fullCaseRevisionScan`.

| Cases / bookings | One case enqueue (ms) | One booking enqueue (ms) | Pending after 10k same-case edits | Batch 100 (ms) | Heap delta (bytes) |
|---:|---:|---:|---:|---:|---:|
| 10,000 / 30,000 | 0.260 | 0.173 | 1 | 295.779 | 44,976,584 |
| 50,000 / 150,000 | 0.276 | 0.175 | 1 | 310.924 | 201,250,976 |
| 100,000 / 300,000 | 0.747 | 0.199 | 1 | 311.536 | 395,375,512 |

## 100k / 300k acceptance

- Production one-case save: 2288.736 ms; 1 candidate; 1 visited; full scan false; 1 durable operation; 0 global clone/fingerprint calls.
- One case enqueue: 0.747 ms; 1 entity visited; 1 operation.
- One booking enqueue: 0.199 ms; 1 entity visited; 1 operation.
- Case / booking payload: 1426 / 1033 bytes.
- 10,000 offline edits: 1122.748 ms; 1 final pending operation.
- One acknowledgement while unrelated state changed: 0.417 ms; unrelated operation retained.
- Cursor tie test: 1001/1001 unique rows.
- Bootstrap pages: 200 case pages at 500; 600 booking pages at 500.
- No RangeError: PASS. Overall: PASS.
