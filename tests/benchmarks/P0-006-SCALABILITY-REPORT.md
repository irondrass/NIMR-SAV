# P0-006 — Scalability benchmark report

All values are **FINAL CORRECTED MEASUREMENT** unless explicitly marked **PARTIAL CHECKPOINT** or **ESTIMATE**. Aggregated only from saved individual result files; this aggregation did not rerun workers.

## Case scales

| Scale | Raw cases | Raw bookings | Raw exact | Normalized cases/bookings | normalizeState | index build | normalized stringify |
|---:|---:|---:|---|---|---:|---:|---|
| 1000 | 1000 | 3000 | true | 1000/3000 | 93.50 ms | 10.03 ms | PASS |
| 10000 | 10000 | 30000 | true | 10000/30000 | 846.05 ms | 107.58 ms | PASS |
| 50000 | 50000 | 150000 | true | 50000/150000 | n/a | 581.51 ms | PASS |
| 100000 | 100000 | 300000 | true | 100000/300000 | 9687.30 ms | 1183.08 ms | ERROR |

100k raw counts: cases 100000, bookings 300000, unique IDs 100000, unique VINs 100000. Normalized counts: 100000 cases / 300000 bookings. Normalize timing: 9687.30 ms. afterNormalize RSS/heap: {"rss":2573316096,"heapTotal":1586016256,"heapUsed":1318756384,"external":1947119}. afterIndex RSS/heap: {"rss":2582913024,"heapTotal":1243201536,"heapUsed":1092853816,"external":1947119}. Index: 1183.08 ms. Stringify: ERROR (RangeError: Invalid string length).

50k and 100k are **PARTIAL CHECKPOINT** results because workers reached timeout. Normalized stringify at 100k is a measured Node/V8 RangeError, not a platform-wide claim.

## Lookups and operations

| Scale | Lookup | Batch repetitions | Batch median ms | Mean ms/op |
|---:|---|---:|---:|---:|
| 1000 | id | 1000 | 3.44 | 0.003 ms/op |
| 1000 | vin | 1000 | 432.35 | 0.432 ms/op |
| 1000 | plate | 1000 | 462.84 | 0.463 ms/op |
| 1000 | orNavNumber | 1000 | 571.93 | 0.572 ms/op |
| 10000 | id | 1000 | 4.22 | 0.004 ms/op |
| 10000 | vin | 1000 | 4369.23 | 4.369 ms/op |
| 10000 | plate | 1000 | 4741.47 | 4.741 ms/op |
| 10000 | orNavNumber | 1000 | 5867.39 | 5.867 ms/op |
| 50000 | id | n/a | n/a | n/a |
| 50000 | vin | n/a | n/a | n/a |
| 50000 | plate | n/a | n/a | n/a |
| 50000 | orNavNumber | n/a | n/a | n/a |
| 100000 | id | n/a | n/a | n/a |
| 100000 | vin | n/a | n/a | n/a |
| 100000 | plate | n/a | n/a | n/a |
| 100000 | orNavNumber | n/a | n/a | n/a |

100k search: 840.49 ms; sort: 900.11 ms; conflict: 1612.72 ms. These are single-operation medians; interactive classification applies only to mean ms/op.

## Dashboard

| Scale | Today status | Today time | Today digest | Month status | Month time | Month digest |
|---:|---|---:|---|---|---:|---|
| 1000 | PASS | 51.16 ms | {"filtered":1000,"filteredCases":1000,"periodCases":108,"activeCases":75,"createdCases":36,"scheduledAppointments":13} | PASS | 450.21 ms | {"filtered":1000,"filteredCases":1000,"periodCases":1000,"activeCases":700,"createdCases":1000,"scheduledAppointments":250} |
| 10000 | PASS | 741.33 ms | {"filtered":10000,"filteredCases":10000,"periodCases":1068,"activeCases":747,"createdCases":356,"scheduledAppointments":91} | PASS | 7332.50 ms | {"filtered":10000,"filteredCases":10000,"periodCases":10000,"activeCases":7000,"createdCases":10000,"scheduledAppointments":2500} |
| 50000 | n/a | n/a | n/a | n/a | n/a | n/a |

The 1k corrected dashboard is measured, not safety-exceeded: today 51.16 ms, month 450.21 ms. 10k and 50k used isolated fresh dashboard workers; 50k is **PARTIAL CHECKPOINT/TIMEOUT**.

## Stress and audit

- 100 bookings/case (100000 bookings): PASS; conflict PASS; stringify PASS.
- 500 bookings/case (500000 bookings): TIMEOUT; conflict PASS; stringify ERROR.

| Audit entries | Status | Generation | Stringify | Parse | JSON bytes | RSS/heap |
|---:|---|---:|---|---|---:|---|
| 10000 | PASS | 2.57 ms | PASS | PASS | 1507781 | {"rss":60710912,"heapUsed":7310512} |
| 100000 | PASS | 16.13 ms | PASS | PASS | 15277781 | {"rss":199086080,"heapUsed":34040448} |
| 1000000 | PASS | 244.79 ms | PASS | PASS | 154777781 | {"rss":1389289472,"heapUsed":303140448} |

## Snapshot density and bottlenecks

Measured bytes/case: 1000: 9154.0, 10000: 9145.8, 50000: 9148.3. Estimated 100k snapshot size from latest successful density: **ESTIMATE**, not a successful 100k serialization.

Corrected top five: (1) normalized snapshot serialization at 100k; (2) full-state normalization at 50k; (3) VIN/plate/OR fallback lookups; (4) high-density booking conflict; (5) full-collection search/sort and dashboard traversal at 50k.

Machine-readable source: results/p0-006-results.json.
