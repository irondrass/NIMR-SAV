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

50k and 100k are **PARTIAL CHECKPOINT** results because workers reached timeout. Normalized stringify at 100k is **MEASURED** as a Node/V8 RangeError in this synthetic benchmark, not a platform-wide claim.

## Lookups and operations

| Scale | Lookup | Batch repetitions | Batch median ms | Mean ms/op |
|---:|---|---:|---:|---:|
| 1000 | id | 1000 | 3.441200 | 0.003441 ms/op |
| 1000 | vin | 1000 | 432.347000 | 0.432347 ms/op |
| 1000 | plate | 1000 | 462.836300 | 0.462836 ms/op |
| 1000 | orNavNumber | 1000 | 571.932600 | 0.571933 ms/op |
| 10000 | id | 1000 | 4.215400 | 0.004215 ms/op |
| 10000 | vin | 1000 | 4369.225500 | 4.369225 ms/op |
| 10000 | plate | 1000 | 4741.472000 | 4.741472 ms/op |
| 10000 | orNavNumber | 1000 | 5867.391800 | 5.867392 ms/op |
| 50000 | id | 100 | 0.408300 | 0.004083 ms/op |
| 50000 | vin | 100 | 2457.628900 | 24.576289 ms/op |
| 50000 | plate | 100 | 2614.666400 | 26.146664 ms/op |
| 50000 | orNavNumber | 100 | 3179.022600 | 31.790226 ms/op |
| 100000 | id | 100 | 1.304400 | 0.013044 ms/op |
| 100000 | vin | 100 | 5140.748500 | 51.407485 ms/op |
| 100000 | plate | 100 | 5512.566300 | 55.125663 ms/op |
| 100000 | orNavNumber | 100 | 6904.273400 | 69.042734 ms/op |

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

Measured bytes/case: 1000: 9153.96300, 10000: 9145.80090, 50000: 9148.32268. **ESTIMATE:** 100k snapshot projection from the latest successful 50k density is 914832268 bytes, ~914.8 MB decimal (~872.5 MiB). It was not successfully serialized at 100k.

**MEASURED:** normalized JSON.stringify at 100k fails with RangeError; 100k normalizeState is 9687.30 ms; 50k/100k lookup timings are present in the table; 100k conflict is 1612.72 ms; 100k search/sort are 840.49 ms/900.11 ms; 10k dashboard month is 7332.50 ms; 50k dashboard is TIMEOUT.

**PARTIAL:** 50k and 100k case workers, isolated 50k dashboard, and 500k-booking stress preserve checkpoint evidence but did not complete.

**INFERRED:** full-collection traversal and fallback lookup growth are code-path interpretations of the measured timings, not formal Big-O claims.

Corrected top five bottlenecks: (1) **CRITICAL — normalized global snapshot serialization:** 100k normalized JSON.stringify RangeError in this Node/V8 synthetic benchmark; (2) **CRITICAL — full-state normalization:** 100k normalizeState measured at 9687.30 ms; (3) **HIGH — VIN/plate/OR fallback lookups:** measured growth through 50k/100k; (4) **HIGH — booking conflict:** 100k cases / 300k bookings measured at 1612.72 ms, with dense 500k-booking stress partial timeout; (5) **HIGH — full-collection search/sort/dashboard traversal:** 100k search/sort 840.49 ms/900.11 ms, 10k month 7332.50 ms, 50k dashboard TIMEOUT.

Machine-readable source: results/p0-006-results.json.
