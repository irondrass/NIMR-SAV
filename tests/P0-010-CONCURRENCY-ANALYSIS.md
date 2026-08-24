# P0-010 Phase 1 — Multi-workstation concurrency and offline chaos

## Scope and method

This is a characterization and design report only. Production JavaScript and SQL are unchanged. The deterministic harness in `tests/helpers/multi_client_sync_harness.mjs` models the current P0-009 client version generator, durable outbox coalescing, SQL RPC decision order, canonical case projection, realtime envelope guard, incremental cursor, restart persistence, audit append behavior, and whole-settings upsert behavior. Static assertions in `tests/offline_concurrency_chaos_p010.test.mjs` bind the model to the current production source and SQL contract.

The strict acceptance rule is:

> When distinct clients modify the same observed base, either a deterministic merge preserves both non-conflicting changes, or a durable conflict makes the losing mutation visible and recoverable, or the write remains rejected/pending/conflicted. A discarded mutation must never be acknowledged without detectable conflict evidence.

The current implementation fails this rule.

## Architecture map

### Local mutation to durable cloud intent

1. A production mutator changes a case or booking and calls a dirty marker, or bounded revision detection identifies a nominated case.
2. `saveState()` in `js/state.js` increments the case `localRevision`, performs local persistence, and only after confirmed persistence calls `enqueueGranularCloudMutationsAfterPersistence()`.
3. `captureEntityMutationBatch()` in `js/storage.js` consumes the case, booking, audit, and settings mutation markers.
4. `getCloudMutationEntityVersion()` creates a client version from the maximum of entity `updatedAt`, marker `updatedAt`, or `Date.now()`, multiplied by 1000, plus `generation % 1000`. `lastCloudEntityVersion` only guarantees monotonicity inside that JavaScript runtime.
5. `captureEntityMutationBatch()` also computes `expectedVersion` for an upsert as `localRevision - 1`.
6. `buildDurableOperationFromEntityMutation()` makes both `operationId` and `idempotencyKey` from workshop, entity type, entity ID, action, and the client-generated version. There is no workstation/client nonce in this identity.
7. `enqueueDurableOutboxOperation()` stores the operation in IndexedDB. Pending operations for one mutable entity coalesce; the first operation ID/idempotency key is retained while the newest payload/version replaces its contents.

### Durable intent to canonical server row

1. `autoBackupToSupabase()` selects only `pending` and `failed` operations. A `conflict` status is already representable and is excluded from automatic sending, but no granular server response currently creates it.
2. `processGranularOutboxBatch()` orders case upserts before booking upserts and booking deletes before case deletes. This is client ordering, not an atomic server dependency rule.
3. `processGranularOutboxOperation()` changes the operation to `processing`.
4. `sendGranularOutboxOperation()` calls `applyCanonicalSyncEntity()` for cases/bookings.
5. `applyCanonicalSyncEntity()` sends `entityVersion`, `operationId`, payload, and delete state to `nimr_apply_sync_entity`. It does not send `expectedVersion`.
6. The RPC returns a canonical row. Case `repair_orders` is reconciled from that returned row, including stale and idempotent responses.
7. `sendGranularOutboxOperation()` computes `serverAcceptedCurrentOperation`, but always reports acknowledgement. `processGranularOutboxOperation()` therefore deletes the outbox operation even when the returned canonical row belongs to another operation.
8. Network/projection errors retain the operation as `failed`; same-operation replay is idempotent.

### Realtime and incremental remote apply

1. `startSupabaseLiveSync()` subscribes to workshop-filtered `sync_entities`, settings, and audit events.
2. Case/booking events call `handleRemoteCaseChange()` / `handleRemoteBookingChange()`.
3. Both call `applyRemoteEntityRow()`. Its `appliedGranularEntityEnvelopes` map rejects a lower version and most equal-version events.
4. The envelope map is process-memory only. The applied server version is not persisted with the local entity and the map is not seeded from IndexedDB state after restart.
5. An accepted remote row replaces the entire local case/booking or removes it, then dirty markers and `saveState({ skipCloud: true, boundedEntityDetection: true })` persist it without outbound echo. A pending local outbox operation is not consulted and no granular conflict is recorded.
6. `rememberRemoteCaseComparable()` prevents remote case application from looking like a fresh local case mutation to bounded revision detection. It does not record server causality.
7. Missed realtime is recovered by `pullLatestSupabaseBackup()` → `pullGranularEntityGroup()` → `fetchGranularEntityPage()` → `persistRemoteGranularPage()` → `applyRemoteEntityRow()`.
8. The incremental cursor is the compound `(updated_at, entity_id)` transport position. It is not and must not become an entity conflict version.

### Existing conflict facilities

- `mergeRemoteStateIntoLocal()` can create `state.syncConflicts` from legacy whole-snapshot merges using `localRevision` / `syncRevision` heuristics.
- The P0-009 granular handlers do not call that merge path, `recordSyncConflict()`, or any equivalent conflict detector.
- `getOpenSyncConflicts()` and `resolveSyncConflict()` support the existing indicator and resolution controls.
- `syncLog` is operational history, not a concurrency token.
- `state.syncConflicts` is local state. It is insufficient as the sole record of a rejected distributed write because another workstation cannot recover it and the server cannot prove it existed.

## Exact current SQL semantics

`nimr_apply_sync_entity` takes a row lock for `(workshop_id, entity_type, entity_id)` and evaluates in this order:

1. If `existing.last_operation_id = p_operation_id`, return the existing row without mutation.
2. Else if `existing.entity_version > greatest(0, p_entity_version)`, return the existing row without mutation.
3. Else if versions are equal, the existing row is a tombstone, and the incoming operation is an upsert, return the existing tombstone without mutation.
4. Otherwise insert or update the row with the incoming client version/payload/action and a server `updated_at`.

Consequences by version relation:

| Incoming relation | Exact result |
|---|---|
| `< current` | Existing canonical row returned; attempted mutation is not applied. Client nevertheless acknowledges and removes its outbox entry. |
| `= current`, same operation ID | Existing row returned as an idempotent replay. Distinct workstation edits can be misclassified here because operation identity is deterministic and lacks workstation identity. |
| `= current`, current tombstone, different upsert | Existing tombstone returned; resurrection rejected. |
| `= current`, all other combinations | Incoming mutation is applied. Thus a different same-version active upsert overwrites, an equal-version delete applies, and a different equal-version delete can replace tombstone metadata/operation identity. |
| `> current` | Incoming mutation is applied, regardless of the base the client actually observed. |

An active-to-delete or delete-to-recreate transition is therefore controlled only by the incoming client-generated number. A newer numeric upsert recreates a tombstone. A stale pre-delete operation with a fast client clock can numerically exceed a later intentional recreation and overwrite it.

## Version-domain audit

- Current `entityVersion`: client wall-clock milliseconds × 1000 + a bounded per-runtime generation suffix, with a runtime-local monotonic floor.
- Current `expectedVersion`: `localRevision - 1` for an upsert; null for deletes, audits, and settings.
- Server enforcement of `expectedVersion`: none. It is stored in the outbox but not passed to the RPC and has no SQL parameter.
- `localRevision` and `entityVersion` are incompatible domains. A value such as local revision 7 is not comparable to an entity version around 1,700,000,000,000,001.
- Client wall clock is currently the effective distributed winner selector. Positive skew can overwrite causally newer work; negative skew can cause a legitimate mutation to be discarded and silently acknowledged.
- Same-millisecond edits can generate identical versions and identical operation IDs on different workstations. The second distinct mutation is then treated as a retry of the first.

## Deterministic two-client harness

The harness provides independent A/B state, persisted entity data, durable outbox, sync metadata, conflicts, local clocks, online/offline state, runtime version counters, and runtime realtime envelopes. The shared server models canonical entities, real-identity case projections, audit rows, settings, SQL comparison order, server time, operation/projection failure, delayed/dropped requests or responses, delayed/reordered realtime, polling, and workshop isolation.

Scripted controls include:

- `A.offline()` / `A.onlineNow()`
- `A.editCase(...)`, `A.editBooking(...)`, and `A.deleteCase(...)`
- `A.sendNext()` / `A.flushAll()`
- `server.delay(...)` / `server.release(...)`
- `server.deliverRealtime(...)` with explicit ordering
- `server.clearRealtime(...)` followed by `client.poll()`
- `server.failNextOperation(...)` / `server.failNextProjection(...)`
- independent `setClock(...)` / `tick(...)`
- `restartClient(...)` from the persisted state/outbox/metadata only

No credentials or real Supabase instance are used.

## Scenario characterization A–O

| Scenario | Initial / actions / ordering | Server result | A final / outbox / conflicts | B final / outbox / conflicts | No silent loss |
|---|---|---|---|---|---|
| A — simultaneous edit | Shared X0. A→A and B→B at the same millisecond. Tested A-send/B-send and reverse. | Both clients generate version `1700000001000001` and the same operation ID. First sender wins; second is classified as same-operation replay. | Converges to first sender; outbox empty; 0 conflicts. | Converges to first sender; outbox empty; 0 conflicts. | **FAIL** — second distinct edit disappears as a false idempotent retry. |
| B — offline divergence | A offline; B edits/flushes; A edits old X and reconnects. Tested normal, +30m, -30m A clocks. | Normal/+30m: stale-base A overwrites B. -30m: A is rejected but acknowledged. | Converges to numeric winner; outbox empty; 0 conflicts. | Same; outbox empty; 0 conflicts. | **FAIL** in all offsets — one edit disappears with no durable evidence. |
| C — multiple offline edits | A X0→X1→X2→X3 offline; one coalesced outbox op. B writes XB later, then A reconnects. | B version is higher; X3 is returned as stale and not applied. | XB; outbox empty; 0 conflicts. | XB; outbox empty; 0 conflicts. | **FAIL** — coalescing is bounded, but the final A payload is silently discarded. |
| D — delete vs update | Old delete then newer update; and newer delete then stale update. | Numeric newer update recreates active X in first order; newer delete remains tombstone in second. Projection follows canonical. | Canonical value/tombstone; empty; 0. | Same; empty; 0. | **FAIL** — structural safety in one order does not provide conflict evidence for the losing causal action. |
| E — delete/recreate ABA | B creates old-base pending upsert with +1h clock. A deletes and intentionally recreates same ID. B reconnects. | B pre-delete payload numerically exceeds recreation and overwrites it. Projection also becomes B payload. | Eventually B payload; no conflict. | B payload; outbox empty; 0 conflicts. | **FAIL** — ABA protection is defeated by client clock. |
| F — same operation retry | Canonical apply succeeds; response is lost; identical operation retries. | First accepted, retry returns same `last_operation_id`; projection remains one row. | Correct payload; outbox goes failed→acknowledged/removed; 0 conflicts. | N/A | **PASS**. |
| G — realtime before ack | A sends; server applies; own realtime arrives while outbox is processing; response released later. | Canonical A once. | A payload, localRevision remains 1, outbox removed after ack, 0 conflicts. | N/A | **PASS**. |
| H — ack before realtime | Same as G, reversed delivery. | Canonical A once. | Identical final result to G. | N/A | **PASS**. |
| I — realtime reordering | Canonical V10→V11→V12; deliver V12,V10,V11. Then restart and deliver stale V10 before envelope map is reseeded. | Server remains V12. | Warm runtime remains V12; restarted client regresses to V10. | Same client role. | **FAIL** — guard is correct only after the current runtime has observed a version. |
| J — missed realtime | B cursor at V10; V11 realtime is dropped; incremental polling runs. | V11. | N/A | V11 via `(updated_at, entity_id)` cursor; no full snapshot. | **PASS**. |
| K — clock skew | A sends before B. B offsets: 0, +5m, +1h, -5m, -1h. | Winners: A at equal clock because false same-op retry; B at positive offsets; A at negative offsets. | Numeric winner; empty; 0. | Numeric winner; empty; 0. | **FAIL / HIGH RISK** — client clock determines authority. |
| L — workstation restart | A edits offline; persisted state/outbox restored after close; B writes; A reconnects. | Outbox survives restart, but B higher version causes A mutation to be returned stale. | B payload; restored outbox goes 1→0; 0 conflicts. Runtime version guard starts empty. | B payload. | **FAIL** for conflict detection; local/outbox durability itself passes. |
| M — case + booking dependency | A queues older case update and later booking execution update. B deletes booking then case. A reconnects. | A case upsert is stale; A later booking upsert is accepted. Case tombstoned, booking active. | Deleted case plus active orphan booking; empty; 0. | Same after realtime. | **FAIL** — client send ordering is not an atomic parent constraint. |
| N — workshop isolation | W1/W2 use identical entity IDs and edit independently. | Separate canonical rows keyed by workshop. | W1 only; no cross event. | W2 only; no cross event. | **PASS**. |
| O — canonical projection | Real identity: application ID `application-case-X`, projection ID `case-or:or-90001`. Lost delete response, newer active upsert, stale delete retry. | Canonical active B; projection active B under structured local ID; none under application ID. | Stale delete acknowledged without corrupting projection. | Active B. | **PASS** for projection consistency; the broader losing-write policy still needs D-model conflicts. |

Additional characterizations:

- Audit: distinct event IDs both survive; retrying the same event ID does not duplicate it. This baseline passes.
- Settings: concurrent `workHours`, `resources`, and `holidays` are whole-payload last-arrival-wins in `app_settings`, with no expected-version check or conflict. One settings edit is silently lost.

## Failure inventory

- Silent loss: A, B, C, D, E, K, L, and M.
- Clock skew: positive skew overwrites causally newer work; negative skew discards a legitimate write; equal timestamps can collide in operation identity.
- Delete/recreate: a fast-clock pre-delete payload can overwrite a later recreation; no epoch/base check exists.
- Realtime reorder: guarded in a warm runtime but can regress after restart because the observed server version is not persisted/seeded.
- Restart/offline: state and outbox survive, but base server version and conflict-detection ability do not exist.
- Parent dependency: an active booking can be accepted after its case is tombstoned.

## Field-level case merge classification

P0-010 should not start with a broad automatic case merge. CAS plus explicit conflict is the safe first implementation. A later selective three-way merge can use persisted base/local/remote payloads as follows:

| Category | Examples | Safe policy |
|---|---|---|
| Independent scalar leaves | client name/phone, vehicle descriptors, insurer, expert contact, individual role note | Auto-merge only when one side equals base or the two sides changed different leaves. Same-leaf divergent edits conflict. |
| Coupled scalar/state fields | status, `nextAction`, appointment status, blocker state, close/archive/delete state, flags and their timestamps | Explicit conflict or domain transition validation. Do not last-write-win or merge independently. |
| Nested maps | `notes`, `durations`, step service/resource/execution maps | Per-key three-way merge for disjoint changes; same-key conflict. Durations/planning keys still require invariant validation. |
| Append-only event arrays | history, customer-contact history, follow-up notes, quality review history | Union by stable event ID; if legacy entries lack IDs, use a deterministic content identity and surface ambiguous collisions. |
| Photo metadata | `photos` | Additions with stable photo IDs can union; delete-vs-edit conflicts. Never put binaries in conflict rows. |
| Claims and supplements | claims, customer claims, estimates/lines, supplements | Treat stable IDs as nested entities. Distinct additions may merge; same claim/line edits, deletion, approval, or monetary changes conflict. |
| Workflow and quality | reception workflow, quality checklist/status/history, flags | Histories may append-merge; current state and transition timestamps must be validated as a state machine and otherwise conflict. |
| Planning references | planning tasks, preferred resources, assignment locks, material resources, subcontracting | Disjoint keyed metadata may merge, but allocations, locks, and time/resource changes require explicit conflict/planning validation. |

## Booking concurrency recommendation

Bookings should reject a stale writer into a durable explicit conflict by default. `start`, `end`, `segments`, `resourceIds`, status, actual start/end, pause/remainder metadata, and work-session state are coupled operational facts. Blind field merge can double-book resources, reverse technician progress, or corrupt elapsed time. Append-only notes/work-session events may later support ID-based merge, but the canonical booking transition should still be admitted through compare-and-swap and server validation. A booking upsert must also verify that its parent case is currently active.

## Settings concurrency recommendation

For P0-010, treat the compact workshop settings payload as one versioned CAS resource and create an explicit conflict on stale writes. Do not silently merge `resources` or `holidays`; deletion and identity semantics are ambiguous. Per-day `workHours` could later support a three-way map merge, but whole-payload conflict is the safer first boundary. Splitting settings into separate versioned domains is a later optimization, not required to prevent silent loss.

## Server-side model comparison

| Model | Correctness/offline behavior | Complexity and risk | Verdict |
|---|---|---|---|
| A — client timestamp LWW | Clock skew and same-tick identity collisions cause silent loss/ABA. Offline is simple but unsafe. | Lowest implementation cost, unacceptable correctness. | Reject. |
| B — server monotonic version only | Removes clock authority but still overwrites concurrent stale-base work unless admission checks the observed base. | Moderate; incomplete alone. | Reject alone. |
| C — CAS with expected/base version | Detects stale-base writes atomically and supports offline retention. Needs a canonical server version and durable conflict/result contract. | Moderate. | Necessary component. |
| D — server monotonic version + explicit conflicts | Server assigns authority; client supplies observed base; mismatch is durable/recoverable; handles offline, retry, delete/recreate, and UI indicator boundary. | Moderate/high but maps cleanly to current RPC/outbox and existing conflict status/UI. | **Recommended** (including C-style CAS admission). |
| E — selected three-way merge + fallback | Best user experience for disjoint changes but requires trustworthy base payloads and field-specific invariants. | Highest migration/test risk. | Later incremental enhancement after D. |

## Recommended P0-010 model

Use Model D with compare-and-swap admission:

1. `entity_version` becomes an opaque server-assigned monotonic token.
2. Every client persists the exact server version last observed for each `(workshop, entity type, entity ID)` independently from business `localRevision`.
3. Every mutable operation carries `baseVersion` (renaming/replacing the misleading current `expectedVersion`) and a globally unique workstation-scoped operation ID.
4. The RPC locks the canonical row. Same operation ID remains the first check for idempotent response loss.
5. If `baseVersion` differs from the current canonical version, the server does not mutate canonical data. It upserts a durable conflict keyed by local operation ID and returns outcome `conflict` plus canonical/conflict identifiers.
6. If the base matches, the server assigns a new version from a sequence, applies the mutation, and returns outcome `accepted`.
7. The client acknowledges only `accepted` or true `idempotent` outcomes. A conflict changes the operation to `conflicted`, retains its local payload, records the server conflict locally, and stops automatic retries.
8. Wall-clock timestamps remain display/audit/transport metadata only.

## Version migration

Avoid rewriting existing rows:

1. Create a PostgreSQL bigint sequence for canonical entity versions.
2. Under migration lock, set the sequence to at least `max(sync_entities.entity_version) + 1`. Existing P0-009 client-generated values remain readable opaque base tokens.
3. Clients treat versions as decimal strings/opaque values and never perform arithmetic, preventing future JavaScript precision assumptions.
4. A client that has observed a legacy row sends that exact legacy value as `baseVersion`. If it still matches, the first post-migration write succeeds and receives a new sequence value. If it does not match, it becomes a conflict.
5. A legacy client with no persisted base must pull canonical before mutation can be automatically admitted. If it submits without a base for an existing row, reject/conflict rather than guess.
6. New entity creation uses a null base and succeeds only when no canonical row exists. Tombstones count as existing rows.

This gives deterministic first-write behavior, preserves all data, and avoids a giant update.

## Conflict record model

Add a workshop-scoped RLS-protected table such as `sync_entity_conflicts` with:

- `id`
- `workshop_id`, `entity_type`, `entity_id`
- `base_version`, `server_version`
- `local_operation_id` with a workshop-scoped uniqueness constraint
- `local_action`
- bounded `local_payload` and `server_payload`
- `server_deleted_at`
- `detected_at`, `status`, `resolved_at`, `resolved_by`, `resolution`

Store only the conflicting entity payloads/metadata, never application snapshots or photo/PDF binaries. The server record is necessary for restart and multi-workstation visibility. Mirror it into the existing normalized `state.syncConflicts` for the current conflict indicator, sync health strip, and `resolveSyncConflict()` boundary.

## Outbox state machine

Keep `pending → processing → acknowledged` and `processing → failed → retry` for transport failures. Activate the already-normalized `conflict`/`conflicted` concept as a terminal automatic-send state:

- `processing → conflicted` only on an explicit server concurrency outcome.
- Conflicted records are durable and excluded from automatic retry.
- `accept_cloud` resolves/removes the operation after a safety record.
- `keep_local` creates a new unique operation based on the current server version; it must not reuse the stale operation ID.
- A future merge resolution similarly creates a new operation based on the current canonical version.

## Realtime and polling guards

Persist an observed canonical envelope per entity in `sync_metadata` (or a dedicated bounded entity metadata store): server version, operation ID, tombstone state, and optionally the base payload needed for later three-way merge.

Before applying realtime or incremental rows:

1. Compare the incoming server version to the persisted observed version.
2. Lower versions are ignored.
3. Equal version with the same operation ID/tombstone is idempotent.
4. Equal version with different content/operation is treated as an invariant error and reconciled from a fresh canonical read, not silently ignored.
5. A higher remote version must be checked against a pending local operation whose `baseVersion` is older. Preserve the local operation and create/fetch conflict evidence before replacing local editable state.
6. Seed the guard from persisted metadata on restart before realtime can apply.

The `(updated_at, entity_id)` cursor remains exclusively a pagination/transport cursor. `entity_version` remains exclusively an entity causality token.

## Delete/recreate and dependency strategy

- Tombstones remain canonical rows with server versions.
- Intentional recreation of the same ID must provide the observed tombstone version as its base and an explicit recreate intent. An old pre-delete operation has an older base and becomes a conflict even if its wall clock is in the future.
- Case delete must tombstone dependent booking entities atomically on the server, or invoke a server transaction that does so.
- Booking upsert must atomically verify that `payload.caseId` references an active canonical case. If the parent is missing/tombstoned, return a durable conflict/rejection and keep the booking operation conflicted.
- Add a bounded expression/index for workshop/type/booking parent lookup if needed; client ordering remains an optimization, not the integrity mechanism.

## Baseline regression results

All requested baselines passed on `72bcb7c86816e4a50cdce5d4ab78412867442628`:

- `tests/granular_sync_outbox_p009.test.mjs`: PASS.
- `tests/entity_indexeddb_p008.test.mjs`: PASS.
- `tests/runtime_indexes_p007.test.mjs`: PASS.
- `tests/offline_sync_conflict_local_data_integrity_v2323.test.mjs`: PASS (the existing non-fatal test-environment `initApp` dataset diagnostic remains after the success output).
- `tests/multiuser_20_concurrent_users.test.mjs`: PASS; this remains a local simulation, not real Supabase concurrency.
- `tests/canonical_roles_statuses_v236.test.mjs`: PASS.
- `tests/role_permissions.test.mjs`: PASS.
- `tests/users_roles_foundation.test.mjs`: PASS.
- `tests/permission_driven_ui_v235.test.mjs`: PASS.
- `tests/users_roles_permissions_actions.test.mjs`: PASS.
- `tests/users_roles_permissions_reception_quality_sensitive.test.mjs`: PASS.

## Exact Phase-2 implementation plan

1. Add a new P0-010 SQL migration with the server sequence, durable conflict table/RLS, richer RPC result, CAS/base-version enforcement, idempotency ordering, tombstone/recreate rules, and case/booking parent integrity.
2. Persist per-entity observed server metadata during bootstrap, polling, realtime, and successful sends; seed it before live sync starts after restart.
3. Replace client-generated conflict authority with opaque base server versions. Retain local timestamps only as metadata. Add workstation-scoped uniqueness to new operation IDs while preserving retry stability for already-created operations.
4. Update the send path to branch on `accepted`, `idempotent`, and `conflict`; never acknowledge a rejected stale mutation. Transition explicit conflicts to durable `conflicted` status.
5. Reconcile local state/projection only from canonical rows while preserving the stale local payload in the outbox/conflict record.
6. Add persisted realtime version/operation guards and pending-local detection. Keep compound cursors unchanged.
7. Enforce case-delete booking cascade and booking-parent-active checks server-side.
8. Route conflict records into existing `state.syncConflicts`, sync strip, and minimal `resolveSyncConflict()` actions without a broad UI redesign.
9. Version workshop settings with the same CAS/conflict contract or a dedicated equivalent RPC.
10. Expand the deterministic harness into acceptance tests, then run the P0-007/P0-008/P0-009 and role/permission regressions.

Expected implementation files:

- `js/storage.js`
- `js/state.js`
- `js/supabase-sync.js`
- `app.js` only if the existing conflict/sync strip needs the new server conflict fields
- new `supabase_p0_010_offline_concurrency.sql`
- `tests/offline_concurrency_chaos_p010.test.mjs`
- `tests/helpers/multi_client_sync_harness.mjs`
- `tests/granular_sync_outbox_p009.test.mjs`
- `tests/helpers/granular_supabase_adapter.mjs`

No planning, photo, export, import, or benchmark production file is expected unless implementation evidence reveals a concrete dependency.

## Phase-1 assessment

- Current distributed-concurrency correctness: **FAIL**.
- P0-009 durability, idempotent retry, isolation, polling, and canonical projection baselines remain intact.
- Recommended next gate: **GO TO IMPLEMENT P0-010 Model D after independent review of this Phase-1 evidence and plan**.

## Ruflo read-only review

Ruflo read-only diff analysis classified the three-file change as `test` with confidence `0.8667`, overall medium risk `25/100`, zero high-risk files, zero critical-risk files, and no additional risk factors. The only file-level reasons were change size: the report was low risk and the large deterministic helper/test were medium risk. No production file appears in the reviewed diff.

The requested semantic risk categories are explicitly reproduced and covered by the reviewed artifacts: lost updates (A/B/C/D), client clock skew (B/K), ABA delete/recreate (E), realtime reorder/restart (I), and server/client version-domain mismatch (architecture/static contract assertions). Ruflo memory, autopilot, installation, and the Windows native bridge were not used.

## Phase 2 — Model D implementation evidence

Phase 2 implements the independently selected model: server-assigned monotonic versions, atomic compare-and-swap admission using the exact observed canonical base, and durable explicit conflicts. The Phase-1 analysis above remains the before-state record.

### Server contract

- `nimr_sync_entity_version_seq` is initialized strictly above the greatest legacy `sync_entities.entity_version`; legacy rows are not rewritten.
- `nimr_apply_sync_entity_v2` receives `p_base_version` and never receives a client-selected target version. Null means “no prior canonical entity” and is accepted only for a genuinely absent row.
- The exact P0-009 RPC signature remains present only as a deterministic upgrade error. Direct authenticated writes to `sync_entities` are revoked, closing alternate CAS bypass.
- Accepted operation receipts make response-loss retry idempotent even after a later operation changes the same entity.
- `sync_entity_conflicts` is workshop-scoped, RLS-protected, retry-deduplicated by `(workshop_id, local_operation_id)`, and retains bounded entity payloads for recovery.
- Case/booking advisory and row locks use parent-case → booking order. Booking upsert verifies an active parent. Case delete allocates a separate sequence version for each dependent booking tombstone. The partial parent expression index bounds lookup.
- Compact workshop settings remain canonical in `app_settings`, with server version/operation columns and `nimr_apply_workshop_settings_v2`; direct authenticated mutation is revoked.

### Client durability and state machine

- New operations use `crypto.randomUUID()` through `makeOutboxIdentifier()`; operation IDs remain stable for retry.
- New mutable operations carry `baseVersion`, derived only from persisted observed metadata. Client time and `localRevision` are not server admission tokens.
- Only unsent `pending` operations coalesce. Their original base and operation ID remain stable. `processing`, `failed`, and `conflicted` envelopes are immutable.
- Observed `{serverVersion,lastOperationId,deleted,updatedAt}` metadata is stored per workshop/type/entity in `sync_metadata` and hydrated before realtime subscription.
- Accepted settlement writes observed metadata and deletes the outbox record in one IndexedDB transaction. Conflict settlement writes observed metadata and the `conflicted` operation/linkage in one transaction. An injected transaction failure proves neither half commits.
- Automatic sending selects only `pending` and `failed`; a concurrency conflict is not a network retry.
- `accept_cloud` discards the conflicted envelope and applies canonical state. `keep_local` creates a fresh operation ID from the current canonical base; a second intervening server write can conflict again.

### Realtime and projections

- Lower versions are ignored across restart because the guard is persisted.
- Equal version/same operation is idempotent. Equal version/different operation or contradictory tombstone state is treated as an invariant requiring canonical reconciliation, not blindly applied.
- A higher other-workstation row received while local intent is pending advances observed metadata but does not overwrite the pending local payload; the old-base send becomes an explicit conflict.
- Own-operation realtime before HTTP acknowledgement can reconcile state but never removes the durable envelope; only the RPC settlement acknowledges it.
- Case `repair_orders` remains derived exclusively from the canonical RPC row and continues using `caseSyncLocalId(canonicalCase)`. Conflict and idempotent retry cannot project rejected local payload.

Known separate projection limitation: `caseSyncLocalId()` intentionally remains the historical structured identity rule. Changing OR/VIN/plate/client identity fields can therefore require cleanup/migration of an older `repair_orders.local_id`; P0-010 does not redesign that projection identity contract. The concurrency fix guarantees that whichever projection is reconciled is built from canonical data, but a global projection-key migration remains separate work.

### Deterministic acceptance

Scenarios A–W now pass. This includes five clock offsets, same-millisecond unique operation IDs, offline X1→X3 coalescing, delete/update and delete/recreate ABA, response loss, both realtime/ack orders, reordered realtime across restart, missed-event polling, restart durability, workshop isolation, real projection identity, old-client rejection, response-loss plus U2, atomic settlement failure, conflict restart, realtime with local pending, both case-delete/booking-upsert serial orders, settings CAS, and existing-row unknown-base rejection. Audit append idempotency and projection-failure retry also pass.

The normal mutation path remains entity-bounded: one observed-metadata lookup/write and one outbox envelope per changed entity. It adds no global fingerprint, state clone, or entity scan. Case delete work is bounded to indexed dependent bookings. The P0-009 100k enqueue benchmark was not rerun because detector/coalescing asymptotics and benchmark logic were not changed; the targeted P0-010 evidence exercises only concurrency/send/metadata behavior.

### Idempotent receipt/current-canonical correction

Scenario X distinguishes the historical version assigned to an accepted operation from the current canonical version returned on a late retry. U1 is accepted at V101, U2 later advances the entity to V102, and an exact U1 retry now returns `acceptedVersion=101`, `serverVersion=102`, and `canonical.entity_version=102`. The next U3 therefore uses base V102. Workshop settings exercise the same contract at V201/V202.

The client normalizer gives current-version authority to `canonical.entity_version`, then `canonical.server_version`, and only then the top-level outcome version. Persistent observed metadata independently rejects lower-version replacements, including their tombstone and last-operation fields. The same monotonic selection happens inside the single IndexedDB settlement transaction, so a late U1 acknowledgement removes only U1, preserves U2/U3, and retains observed V102. An injected transaction failure leaves all three operations and V102 recoverable; retry completes without a partial state.

Accepted receipts still prove that the original operation succeeded and preserve its `accepted_version`. They no longer claim that the entity remains at that historical version. Idempotent conflict receipts may intentionally carry the original conflict snapshot; a deterministic late-replay test confirms that such a historical V101 snapshot cannot lower already-observed V102 metadata. Restart followed by delayed realtime V101 likewise leaves V102 and the newer local intent intact.
