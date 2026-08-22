# P0-007 Runtime Indexes Benchmark

Targeted benchmark only. It uses the deterministic P0-006 scalability dataset, does not stringify global state, and runs each scale in a fresh Node process with `--expose-gc`.

## Exact operation counts

- Identity lookups: 10000 per identity type and scale.
- Case/resource/day collection lookups: 10000 per helper and scale.
- Warm index access: 10000 before and 10000 after explicit invalidation/rebuild.
- Conflict checks: 20 per scale.
- Normalize, cold build, and explicit invalidation rebuild: exactly once per scale.

## Results

| Cases / bookings | normalizeState ms | cold index ms | warm index ms/op | ID ms/op | VIN ms/op | plate ms/op | OR ms/op | case bookings ms/op | conflict ms/op | candidates |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 / 30,000 | 957.796 | 200.589 | 0.002761 | 0.002308 | 0.005036 | 0.005341 | 0.004938 | 0.002403 | 5.773 | 252/30000 |
| 50,000 / 150,000 | 6296.072 | 2214.539 | 0.007712 | 0.005612 | 0.009374 | 0.014833 | 0.010460 | 0.005681 | 55.423 | 1326/150000 |
| 100,000 / 300,000 | 14442.279 | 3603.729 | 0.008871 | 0.004717 | 0.009790 | 0.007135 | 0.008191 | 0.005985 | 107.894 | 2652/300000 |

## 100k comparison with P0-006

- ID: 0.004717 ms/op (2.7x versus 0.012788235 ms/op).
- VIN: 0.009790 ms/op (5148.1x versus 50.399495098 ms/op).
- Plate: 0.007135 ms/op (7574.2x versus 54.044767647 ms/op).
- OR: 0.008191 ms/op (8264.2x versus 67.688954902 ms/op).
- Conflict: 107.894 ms (14.9x versus 1612.7232 ms); candidate set 2652/300000.
- Cold index build: 3603.729 ms versus 1183.0827 ms. The added identity and resource/day maps make this cost explicit.

## Memory at 100k / 300k bookings

- After normalize: RSS 1328.96 MiB; heapUsed 836.42 MiB; heapTotal 1175.14 MiB.
- After cold index: RSS 1362.51 MiB; heapUsed 906.94 MiB; heapTotal 1061.55 MiB.
- Index delta: RSS 33.55 MiB; heapUsed 70.52 MiB; heapTotal -113.59 MiB.
- After warm reads: RSS 1366.00 MiB; heapUsed 907.29 MiB; heapTotal 1040.55 MiB.
- After explicit invalidation/rebuild: RSS 1367.33 MiB; heapUsed 907.29 MiB; heapTotal 1058.05 MiB.

These are Node process measurements, not browser memory-limit claims.

## Acceptance

- vin: PASS
- plate: PASS
- orNavNumber: PASS
- id: PASS
- bookingByCase: PASS
- conflict: PASS
- warmAccessNoRebuild: PASS

Overall: PASS
