# P1-001 — Planner canonical behavior and scale analysis

## 1. Scope and validated base

- Repository: `irondrass/NIMR-SAV`.
- Required base: `origin/main` at `81ea6ee8c410ed1b5d41d6ba28553fb9d6f033a0` (`Merge pull request #14 from irondrass/p0-010-offline-concurrency-chaos`).
- Pre-analysis branch: `p0-010-offline-concurrency-chaos`.
- Analysis branch: `p1-001-planner-analysis`, created directly from the required SHA.
- HEAD before Phase 1 files: `81ea6ee8c410ed1b5d41d6ba28553fb9d6f033a0`.
- Working tree before analysis: clean.
- Production changes: none. Historical branches/commit were inspected only; none was checked out, applied, merged, rebased, or modified.
- Authorized outputs only: this report, the P1-001 canonical characterization, and the scalability benchmark.

This phase characterizes current main. `PASS` means the observed result satisfies the scenario's current safety expectation; it does not freeze every implementation detail as the desired future contract. `FAIL` means a deterministic current-main result violates the stated constraint or produces an unsafe/suboptimal result. `AMBIGUOUS` means the code is deterministic but the business meaning is not defined tightly enough.

## 2. Current architecture

The application is a classic browser script bundle, not an ES module graph. `index.html` loads, in order, `utils.js`, `state.js`, `ui-cases.js`, `estimate-import.js`, `ui-planning.js`, `storage.js`, `work-hours-sync.js`, `planning.js`, business rules, Supabase files, then `app.js`. Planner functions therefore share global `state`, `generatedProposals`, helpers, permission guards, runtime indexes, persistence, and rendering functions.

Primary files and responsibilities:

| File | Planner responsibility |
|---|---|
| `js/planning.js` | proposal generation, sequential and graph scheduling, slot/resource selection, conflict validation, booking conversion, acceptance, technician task lifecycle, rescheduling, subcontracting, delivery estimates |
| `js/state.js` | templates, defaults, canonical roles/permissions, case/resource/booking normalization, PDF task sequentializer, state replacement, save orchestration |
| `js/utils.js` | working-time primitives, cloning, date helpers, resource lookup, planning colors |
| `js/ui-cases.js` | P0-007 indexes, proposal actions/rendering, duration/resource controls, business-rule gates, manual task actions |
| `js/ui-planning.js` | indexed daily/resource rendering, Gantt/mobile planning, resources/leaves/work-hour UI |
| `app.js` | PDF-first case creation and initial proposal preparation; planning/resource toolbar bindings |
| `js/estimate-import.js` | PDF labor parsing/classification, phase allocation, duration recomputation, invalidation of prior planning |
| `js/storage.js` | local persistence and entity mutation/outbox integration reached by `saveState` |
| `js/supabase-sync.js` | online atomic proposal reservation and granular entity synchronization |
| `js/business-rules-v2187.js` | additional workflow/business helpers; canonical appointment checks are currently in `ui-cases.js` |
| `index.html` | load order and planner UI surfaces |

There is no `js/permissions.js`; canonical permission definitions and guards are in `js/state.js`.

Core call/data flow:

```text
UI/PDF caller
  -> generateAppointmentOptions(item)
       -> generateSingleProposal(item, now)
            -> clone every accepted booking except the same case
            -> getPendingProposalBookings(same case excluded)
            -> schedulePipeline
                 -> getExplicitPlanningTasks
                 -> scheduleTaskGraph OR scheduleSequentialPipeline
                      -> buildInternalTaskStep/scheduleSingleStep
                      -> findBestResourceSlot
                      -> buildResourceSlotCandidate
                      -> findEarliestSlot
                      -> validatePlanningCandidate
                      -> makePlanningStep
                      -> temporary stepToBooking appended to working set
       -> buildAvailableAppointmentDates
            -> generateSingleProposal once per attempted working day until limit
  -> generatedProposals[item.id] (memory only)
  -> renderProposals
  -> acceptProposalAtomically
       -> recalculateProposalForAcceptance
       -> optional reservePlanningProposalAtomically (Supabase RPC)
       -> acceptProposal
            -> recalculates again
            -> deletes every local booking for the case
            -> proposalToBookings / stepToBooking
            -> state.bookings + item.appointment
            -> saveState -> IndexedDB/entity dirty tracking/outbox/cloud flush
  -> render -> renderPlanning
       -> P0-007 day/resource/case indexes
```

`buildAvailableAppointmentDates` starts from each global working day and accepts a date only when the complete proposal starts on that date. It catches and suppresses scheduling errors per date. The production call uses horizon 60 and limit 14.

`schedulePipelineWithAnticipatedNewParts` is a compatibility symbol only and immediately delegates to `scheduleSequentialPipeline`.

## 3. Canonical planning data model

PDF-first flow:

```text
PDF bytes/text
  -> parsed laborLines + distributedLines
  -> getPdfEstimateTaskRows: aggregate by phase
       id/phase/operation/laborHours/requiredRole/sourceLineIds/sourceOperations
  -> item.planningTasks + item.durations
  -> normalizePdfPlanningTasksForCase
       phase ordering + forced linear dependencies + parallelizable=false
  -> getExplicitPlanningTasks
  -> scheduleTaskGraph
  -> proposal.steps
  -> temporary bookings used only during proposal calculations
  -> accepted proposal bookings
  -> state.bookings
  -> saveState / entity IndexedDB / granular sync outbox
```

Important alternate flow: importing a later estimate into an existing case recomputes `durations` and clears planning but does not rebuild `planningTasks`. Therefore materially similar work can enter task-graph mode when created through the PDF-first case flow and sequential fallback when added to a legacy/manual case.

Field classification:

| Field | Classification | Actual use / caveat |
|---|---|---|
| `planningTasks` | CANONICAL | preferred explicit task input and normalized case field; currently passed through the PDF sequentializer for every case source |
| `workshopTasks` | LEGACY FALLBACK | read by `getExplicitPlanningTasks` only when `planningTasks` is absent; `normalizeCase` does not retain it |
| `tasks` | LEGACY FALLBACK | graph input only when semantic flags are present; `normalizeCase` migrates it into `planningTasks` and rewrites graph semantics |
| `durations` | CANONICAL | case phase-hour summary and sequential scheduling input; also derived from claims when absent |
| `stepServiceTypes` | CANONICAL (sequential UI) | changes role/equipment template; ignored by explicit graph tasks |
| `stepExecutionModes` | CANONICAL (sequential compatibility) | any external value synthesizes a linear explicit graph from durations |
| `stepSubcontractorIds` | CANONICAL (sequential compatibility) | provider IDs used by the synthesized external graph |
| `stepPreferredResources` | CANONICAL (sequential UI), AMBIGUOUS semantics | strong preference for sequential steps; ignored by explicit graph scheduling |
| `stepAssignmentLocks` | CANONICAL UI field, FAILED semantics | lock is read as the same preference as manual selection; inactive/incompatible lock silently falls back; ignored by graph tasks |
| `dependencies` | CANONICAL | graph and accepted booking dependency IDs/keys |
| `dependsOn` | LEGACY FALLBACK | normalized alias for `dependencies` |
| `parallelizable` | CANONICAL | explicit opt-in; also disables vehicle exclusivity through defaulting |
| `vehicleExclusive` | CANONICAL / DERIVED | explicit boolean; default is `!parallelizable` for tasks and true for steps/bookings |
| `vehicleLocation` | CANONICAL / DERIVED | internal/external/transport, inferred from service/subcontract state when absent |
| `requiredRole` | CANONICAL | primary human/provider compatibility requirement |
| `requiredCategory` | CANONICAL | additional compatibility requirement; both role and category must match |
| `equipmentRole` | CANONICAL task input / DERIVED booking allocation | selects a separate equipment resource; not copied as a named field into accepted bookings |
| `serviceMode` | CANONICAL | internal/external task and booking mode |
| `subcontractorId` | CANONICAL task input | provider selector; accepted steps/bookings use the separate `subcontractId` assignment identifier |
| `sourceLineIds` | CANONICAL provenance on task/proposal | preserved through planning step construction but dropped by `stepToBooking` |
| `sourceOperations` | CANONICAL provenance on task/proposal | preserved through planning step construction but dropped by `stepToBooking` |
| `sourceLaborHours` | CANONICAL provenance on task/proposal | preserved through planning step construction but dropped by `stepToBooking` |

Accepted historical bookings remain broadly interpretable because `normalizeBooking` preserves task IDs, dependencies, parallelism, vehicle constraints, roles/categories, resources, productive segments, status, and service/subcontract fields. Missing/invalid resource references or segments cause a supposedly planned legacy booking to be discarded. Old bookings default `vehicleExclusive` to true and `planningMode` to `standard`, so later task-model changes can alter how old records are interpreted.

## 4. Task graph vs sequential fallback

Exact selection rule:

1. `schedulePipeline` calls `getExplicitPlanningTasks(item)`.
2. If the returned array is non-empty, `scheduleTaskGraph` is selected.
3. Otherwise `scheduleSequentialPipeline` walks `STEP_TEMPLATES` in fixed order.

`getExplicitPlanningTasks` precedence:

1. non-empty `planningTasks`;
2. otherwise non-empty `workshopTasks`;
3. if the case source is `pdf_estimate`, the chosen list is normalized into the canonical PDF phase sequence;
4. if neither exists but any `stepExecutionModes` entry is `external`, durations are converted into a forced linear task graph;
5. otherwise legacy `tasks` is used only when at least one task has `dependencies`, `dependsOn`, `parallelizable === true`, or `serviceMode === "external"`;
6. all other cases use sequential durations.

Consequences:

- Initial PDF-created cases use task graph because `app.js` creates `planningTasks`.
- PDF normalization sorts phases `body, oilService, mechanical, electrical, prep, paint, reassembly, finish, quality`, forces a dependency on the previous phase, forces `parallelizable=false`, and defaults exclusivity. PDF work therefore cannot use graph parallelism even if its input declared it.
- Raw explicit graph tasks preserve dependencies and can run independent `parallelizable` tasks concurrently.
- `normalizeCase` calls the PDF normalizer on `item.planningTasks || item.tasks` without checking source. Non-PDF dependency/parallelism semantics can therefore be silently overwritten during load.
- Sequential flow always advances a single cursor, so it cannot parallelize phases.
- Graph flow schedules lexically sorted ready task IDs. This is deterministic but task ID naming influences allocation order.
- Resource and equipment requirements are independently selected and validated.
- External tasks become outbound transport, external work, and return transport steps inside the graph.
- The same business work can produce different schedules depending on creation/import history.

## 5. Resource/equipment constraints

| Constraint | Expected current rule | Observed result / evidence | Ambiguity or risk |
|---|---|---|---|
| A technician role | active compatible role required | PASS O; aliases normalized | requested explicit resource mismatch is permanent |
| B technician category | role and category must both match | PASS P | category vocabulary shares role normalizer |
| C equipment role | separate compatible equipment booked with technician | PASS H/I | `equipmentRole` name is not persisted on booking |
| D site | internal/external/transport must match | PASS Q/W | external provider has special compatibility handling |
| E work hours | global slot builder plus narrower resource calendar | PASS J | resource calendars cannot expand beyond global hours |
| F lunch/non-working | productive segments skip gap | PASS K | one booking spans multiple segments |
| G holiday | global day has no intervals | PASS L | resource-specific calendar is not consulted until after global slot construction |
| H resource leave | leave booking consumes resource capacity | PASS M | leave uses normal booking conflict machinery |
| I inactive resource | excluded / permanently incompatible | PASS N | strict lock to inactive resource is not strict |
| J daily capacity | per-resource per-day productive minutes | FAIL X/Y under default hours | search jumps to next day rather than seeking a later same-day start |
| K existing booking | active non-completed booking consumes capacity | PASS G/H/U | closed-case/completed booking is non-blocking |
| L same-case booking | vehicle/location constraints apply; generation excludes own accepted bookings | PASS E/AA | exclusion enables destructive full-case regeneration risk |
| M pending proposal | local unaccepted proposals consume temporary capacity | PASS T/V | not persisted or shared across workstations |
| N manual preferred | preferred resource outranks earlier slot/load | AMBIGUOUS R | behaves closer to hard priority than soft preference |
| O manual locked | should remain locked or fail explicitly | FAIL S | implemented as preference and ignored by graph tasks |
| P balancing | body/painter resources sorted by 14-day load, then name; candidate also compares daily load/cases/load | PASS existing assignment tests | all load calculations scan the supplied array |
| Q stable rotation | FNV-style hash tie break plus stable resource key | PASS AB | deterministic for same case/task/resource set |
| R fast lane | non-fast jobs exclude fast-lane resources; fast jobs prioritize them | code/static + existing assignment coverage | eligibility is based on summed `durations`, not explicit graph task total |
| S external work | transport-out, provider work, transport-return | PASS W | task graph external flow is consistent; manual reserve path is separate |
| T vehicle-exclusive overlap | same case cannot overlap when exclusive or locations differ | PASS E | `parallelizable=true` implicitly makes default vehicle exclusivity false |

Conflict validation does use P0-007 resource/day and case candidates when available. In the benchmark the final candidate set was 7 rows out of 300,007 supplied. Resource sorting and load metrics still scan the full supplied list.

## 6. Long-task current behavior

The low-level primitives support cross-day productive segments:

- `buildWorkingSlot` repeatedly consumes global work intervals, skips non-working gaps/days, and returns one slot with multiple segments.
- `addWorkingMinutes` delegates directly to `buildWorkingSlot`.
- A 1,200-minute primitive slot produced six productive segments.

Observed with resource daily capacity 420 minutes and current default global hours (480-minute weekdays, 300-minute Saturday):

| Duration | Sequential fallback | Task graph, technician + equipment | Result |
|---:|---|---|---|
| 600 min | one step/booking, three segments; delayed from Mon 7 Sep to Sat 12 Sep and Mon 14 Sep | same, painter + booth reserved across all segments | schedules, but not at the earliest legal Monday 09:00 start |
| 840 min | fails with “duration 14 h greater than daily capacity 7 h” | fails with no compatible resource combination | no schedule |
| 1,200 min | fails with “duration 20 h greater than daily capacity 7 h” | fails with no compatible resource combination | no schedule |

Cause: a candidate built at 08:00 consumes the full 480-minute weekday before spilling. Daily-capacity validation rejects it and returns the next day boundary; `findEarliestSlot` therefore never tries 09:00 on that day. A 600-minute task eventually finds Saturday's 300 minutes plus Monday's 300 minutes. 840/1,200 always contain at least one full over-capacity weekday and exhaust the search.

Control characterization with global intervals aligned to 420 minutes/day: 600, 840, and 1,200 all schedule in both modes as a single multi-day step with 3, 4, and 6 productive segments respectively. The missing capability is therefore not segmentation itself; it is coordination between slot construction, daily capacity, and the search cursor.

Historical commit `416c1d1` instead split only sequential tasks into separate hard-coded 420-minute steps. Current main did not apply it.

## 7. Body/paint separation current behavior

Template roles/equipment:

| Step | Primary role | Equipment | Default dependency behavior |
|---|---|---|---|
| body/dismantling | `tolier` | none | first relevant phase |
| preparation | `peintre` | `zone_preparation` | after previous PDF/sequence phase |
| paint | `peintre` | `cabine` | after preparation |
| reassembly | `tolier` | none | after paint |
| finish | `peintre` | none | after reassembly |
| quality, if explicit | `controle` | none | after finish in PDF normalization |

Sequential mode creates an assignment context. Body records a preferred bodyworker for reassembly; preparation/paint record a preferred painter for paint/finish; equipment is preferred by role. Because preferred resources outrank earlier completion, this is strong continuity when the resource remains compatible.

Task-graph mode creates the same assignment context and calls `rememberPlanningAssignment`, but `buildInternalTaskStep` never reads it. It passes only task-level `preferredResourceId`/`preferredEquipmentId`. Deterministic Z showed body on `body-1`, reassembly on `body-2`, preparation on `painter-2`, paint on `painter-1`, and finish back on `painter-2`. Thus bodyworker/painter continuity is not enforced or preferred in the current PDF task-graph path.

Bodyworker and painter resources are otherwise independent. Preparation and paint reserve their distinct equipment. Dependencies and vehicle exclusivity serialize the representative PDF flow. Raw explicit tasks can run independently only when dependencies permit and `parallelizable=true` removes the default exclusive-vehicle constraint. If one required role or equipment has no capacity, the whole proposal fails; there is no partial proposal.

## 8. Historical 416c1d1 comparison

Read-only inspection:

- Commit: `416c1d1d78bc3fc81bedd738f06f6dcef39e81af`, “Fix planning: Separation tole/peinture et decoupage des taches longues”.
- Files changed: `js/estimate-import.js` (+12) and `js/planning.js` (+30/-6).
- Nothing was applied.

What it attempted:

1. In estimate parsing, split a mixed `PEINTURE` plus body-keyword (`D/P`, dismantling, removal, dressing, sticking) labor line 50/50 between body and paint.
2. In sequential scheduling only, split phase duration above a hard-coded 420 minutes into multiple calls to `scheduleSingleStep`, naming later blocks “suite N”.

Assessment against current main:

- The parser concept remains relevant for mixed lines that current ordering may classify wholly as paint, but some patterns are already handled earlier with different ratios. The historical placement also means earlier special cases can bypass its new branch.
- The 420-minute value was hard-coded rather than derived per resource/calendar.
- It did implement multiple booking steps, not merely cross-day segments.
- It did not add bodyworker/painter scheduling continuity; “separation” referred to labor classification.
- It affected only sequential fallback. Current PDF-first cases normally use task graph, so its long-task change would not solve the canonical path.
- Multiple blocks reused the same key/task identity without explicit block dependencies, which conflicts with current graph/business-task aggregation expectations.
- Useful concepts for P1: explicit mixed-operation classification tests and deterministic long-work chunk semantics. The implementation itself should not be reused.

## 9. FLUX_PIECES_NEUVES_PLANNING drift

`FLUX_PIECES_NEUVES_PLANNING.md` describes an active conditional optimization: prepare replacement/new parts in parallel with bodywork when painter and preparation zone are free, otherwise fall back to normal sequence; paint remains grouped.

Current implementation deliberately disables it:

```js
function schedulePipelineWithAnticipatedNewParts(item, startAfter, bookings, split) {
  return scheduleSequentialPipeline(item, startAfter, bookings);
}
```

Current PDF task normalization also forces linear dependencies and `parallelizable=false`, so the documented early preparation cannot arise from the PDF-first task graph. Existing `planning_dead_code_cleanup_v236.test.mjs` and scenario AF require compatibility output to equal sequential scheduling and prohibit an anticipated booking.

Drift classification: **stale functional documentation describing intentionally disabled historical behavior**. Neither document nor disabled implementation is assumed correct for future P1.

## 10. Existing test inventory

Direct planner/adjacent inventory inspected and run before P1-001 files were created:

| Test | Baseline | Approx runtime | Actual coverage |
|---|---:|---:|---|
| `tests/audit.test.mjs` | PASS, 12/12 | <0.1 s | broad five-case workflow/planning audit |
| `tests/planning_resource_assignment.test.mjs` | PASS | 0.645 s | balancing, continuity in sequential flow, equipment pair, lunch segmentation, locks, 4k-case sample |
| `tests/planning_resources_conflicts.test.mjs` | PASS | <0.1 s | simultaneous capacity, role, calendar, vehicle, dependencies, graph |
| `tests/pdf_planning_canonical_sequence_v2330.test.mjs` | PASS | <0.1 s | forced PDF phase order/dependency chain and code contracts |
| `tests/planning_business_task_aggregation_v2229.test.mjs` | PASS | <0.1 s | booking family/business-task aggregation |
| `tests/planning_dead_code_cleanup_v236.test.mjs` | PASS | <0.1 s | anticipated-parts compatibility equals sequential path |
| `tests/subcontractor_planning.test.mjs` | PASS | <0.1 s | external provider transport/work/return and lead time |
| `tests/dynamic_reschedule_v2228.test.mjs` | PASS | <0.1 s | dependent booking reschedule behavior |
| `tests/estimated_delivery.test.mjs` | PASS | <0.1 s | delivery estimate/margin/revision |
| `tests/runtime_indexes_p007.test.mjs` | PASS | <0.1 s | identity and booking indexes, conflict candidate filtering |
| `tests/planning_dependencies_sql_v2330.test.mjs` | **FAIL baseline** | <0.1 s | SQL dependency contract; full-audit migration lacks expected `dependencies_value text[]` |
| `tests/planning_rpc_case_reference_v2330.test.mjs` | PASS | <0.1 s | atomic RPC case reference contract |
| `tests/technician_flow.test.mjs` | PASS | 0.050 s | technician lifecycle regression |
| `tests/technician_flow_v2221.test.mjs` | PASS | 0.014 s | technician planning safety |
| `tests/technician_pause_remainder_v2227.test.mjs` | PASS | <0.1 s | pause/remainder reservations |
| `tests/technician_resource_isolation_v231a_bis.test.mjs` | PASS | <0.1 s | technician can act only on own resource tasks |
| `tests/work_hours_conflict_outbound_gate_v2331.test.mjs` | **FAIL baseline** | <0.1 s | static sync gate contract; expected `fetchLatestCloudBackup` block absent |
| `tests/work_hours_ghost_conflict_cleanup_v2331.test.mjs` | PASS | <0.1 s | work-hour conflict cleanup |
| `tests/work_hours_persistence_contract_v2331.test.mjs` | **FAIL baseline** | <0.1 s | static pending-calendar recovery contract absent after sync refactor |
| `tests/closed_archive_duration_v2226.test.mjs` | PASS | <0.1 s | archived/closed task visibility and duration |

The three baseline failures were not modified or “fixed”. Broader search also found workflow, sync, permission, PDF, and benchmark tests containing generic booking/resource terms; the table is the exact directly relevant execution inventory used for P1-001.

## 11. New A-AF characterization matrix

Suite: `tests/planner_canonical_behavior_p1001.test.mjs`.

| ID | Classification | Current-main result |
|---|---|---|
| A | PASS | one sequential body step, no conflict |
| B | PASS | linear graph dependencies preserved by raw graph scheduler |
| C | PASS | two independent parallelizable tasks start together |
| D | PASS | dependency delays dependent task to predecessor end |
| E | PASS | exclusive same vehicle tasks do not overlap |
| F | PASS | different vehicles/resources run concurrently |
| G | PASS | technician booking delays candidate |
| H | PASS | equipment booking delays candidate |
| I | PASS | painter and booth reserved for identical segments |
| J | PASS | work boundary creates next-day segment |
| K | PASS | lunch creates two productive segments |
| L | PASS | holiday skipped |
| M | PASS | leave blocks resource |
| N | PASS | inactive resource rejected |
| O | PASS | required-role mismatch rejected |
| P | PASS | required-category mismatch rejected |
| Q | PASS | site mismatch rejected |
| R | AMBIGUOUS | preferred resource wins even over earlier alternative |
| S | FAIL | inactive locked resource silently falls back |
| T | PASS | local pending proposal blocks capacity |
| U | PASS | accepted booking blocks capacity |
| V | PASS | closed case contributes no pending proposal load |
| W | PASS | external task produces transfer/work/return |
| X | FAIL | 600-minute/420-cap task is delayed to Saturday instead of earliest legal weekday start |
| Y | FAIL | 1,200-minute task fails under default 8-hour weekdays + 420 cap |
| Z | FAIL | graph path loses bodyworker and painter continuity |
| AA | PASS | regeneration excludes own booking and can reuse its slot |
| AB | PASS | equal resources select the same winner over five runs |
| AC | PASS | repeated appointment-date searches are identical |
| AD | PASS | PDF source aggregation survives; dependencies are replaced by canonical linear chain |
| AE | PASS | non-semantic legacy `tasks` still falls back to sequential durations |
| AF | PASS | compatibility function creates no anticipated-parts step |

Totals: **27 PASS, 4 FAIL, 0 UNSUPPORTED, 1 AMBIGUOUS**.

Additional deterministic regressions captured by the suite:

- non-PDF task graphs are rewritten by `normalizeCase`;
- same-case accepted bookings are excluded from regeneration and later replaced wholesale;
- source provenance survives proposal construction but not accepted booking conversion.

## 12. Scale benchmark results

Suite: `tests/benchmarks/planner_scalability_p1001.mjs`; Node `v22.23.2`, Windows x64. Data is deterministic. Bulk bookings are historical and outside the candidate horizon, intentionally measuring the cost of irrelevant supplied rows. Times are approximate wall-clock averages on this workstation.

| Bookings | Single proposal | Appointment 60 | Core best slot | 10-task graph | 8-step sequential | Pending collection (10) |
|---:|---:|---:|---:|---:|---:|---:|
| 1k | 43.28–45.50 ms | 442.91–509.86 ms, 14 dates | 26.52–31.49 ms | 321.78–481.31 ms | 204.86–360.04 ms | 0.22–0.74 ms |
| 10k | 341.72–602.24 ms | 4,171.80–6,562.95 ms, 14 dates | 230.36–351.59 ms | 2,866.48–4,563.52 ms | 1,948.86–3,254.29 ms | 1.22–2.41 ms |
| 100k | 3,293.80–5,594.87 ms | 3,187.35–4,893.72 ms, **1 bounded date** | 2,297.91–3,988.45 ms | 29,094.58–42,791.90 ms | 20,288.69–24,796.50 ms | 19.92–34.40 ms |
| 300k | 11,366.76–20,501.30 ms | 9,242.51–17,537.55 ms, **1 bounded date** | 6,935.77–12,495.25 ms | 88,042.42–98,920.84 ms | 60,881.33–63,252.76 ms | 90.81–97.20 ms |

Appointment horizons at 300k, each bounded to one returned date: 7 days 10,117.31 ms; 30 days 16,229.23 ms; 60 days 17,537.55 ms. Heap deltas are noisy without forced GC, but individual 300k operations observed deltas from roughly +177 MiB to +1,142 MiB; they are evidence of allocation pressure, not retained-memory measurements.

The ranges above combine two completed runs and show material GC/system-load variance without changing the linear conclusion. The initial production-limit run (14 returned dates at every tier) exceeded 360 seconds and was stopped before it emitted results. The completed script records that abort and bounds 100k/300k appointment probes to one date. At 1k/10k it retains the production limit 14. Consequently, large appointment numbers are lower bounds, not full 14-date costs.

The final indexed conflict check saw only 7 candidate bookings from 300,007 supplied, proving the P0-007 conflict subset works. End-to-end times remain unacceptable because other stages copy and rescan the full array.

## 13. Complexity analysis

Current hot-path costs:

| Path | Full-array work | Effective complexity |
|---|---|---|
| `generateSingleProposal` | `filter` every booking, clone every other-case booking, then pending collection scans accepted case IDs | O(N) time and O(N) allocations before scheduling |
| `getPendingProposalBookings` | builds accepted case ID set from all bookings; `state.cases.find` per proposal | O(N + P×C) |
| `buildAvailableAppointmentDates` | calls `generateSingleProposal` per attempted day | O(D × proposal cost), including repeated O(N) clone/index builds |
| `orderPrimaryResourcesForStep` | comparator repeatedly calls 14-day full-array load scans for body/painter resources | approximately O(R log R × N) |
| `buildResourceSlotCandidate` | after slot search, daily load, 14-day load, and active case count scan supplied bookings per resource pair | O(P×E×N) per step in common paths |
| `findEarliestSlot` | conflict validation uses indexed candidates, but an ephemeral index is first built for cloned/temp arrays and rebuilt after appended temporary steps | O(N) index build plus relevant-candidate checks per working set version |
| resource daily usage/conflicts | operate on the indexed candidate subset inside `validatePlanningCandidate` | O(K), where K is relevant resource/day plus same-case rows |
| `scheduleTaskGraph` | clones all supplied bookings, then repeats resource selection/index rebuild/load scans per task | approximately O(T×P×E×N), plus allocations |
| `scheduleSequentialPipeline` | shallow-copies supplied array, then repeats selection/load scans per phase | approximately O(T×P×E×N) |

Largest hotspot: **full-array booking cloning plus repeated full-array resource load/balancing scans inside every candidate resource pair/task/day**. Appointment search multiplies that cost by candidate dates. The indexed conflict detector is not the dominant remaining cost.

Largest semantics-preserving future benefit: build a proposal-local booking view from P0-007 case/resource/day indexes, calculate load summaries once for the requested horizon, and pass only the relevant immutable subset plus temporary proposal rows. This avoids cloning/scanning irrelevant historical bookings while preserving current conflict rules.

## 14. P0-007 index integration opportunities

Current consumption is **PARTIAL**.

Already used:

- `validatePlanningCandidate` calls `getIndexedConflictCandidateBookings` and receives resource/day plus same-case candidates.
- technician active-booking lookup uses resource index.
- case booking lookups and planner rendering use case/day/resource indexes.
- planner case lookup uses indexed `caseById` when available.

Not used by proposal hot paths:

- `generateSingleProposal` still filters and clones the full array.
- `getPendingProposalBookings` still scans all bookings.
- `getResourceLoadMinutes*` and `getResourceActiveCaseCount` still scan their entire supplied array.
- candidate resource ranking does not use `bookingsByResourceId` or precomputed day buckets.
- appointment-date generation rebuilds the proposal working set for every date.

Future P1 can consume `bookingsByCaseId`, `bookingsByResourceId`, `bookingsByDayKey`, and `bookingsByResourceDayKey` without changing the persistent schema. A proposal-local overlay should keep temporary steps separate from the immutable accepted indexed base and merge them only for relevant resource/day/case queries.

## 15. Duplicate/stale proposal risks

Generation and pending proposals:

- Proposal objects have no explicit proposal ID, source booking revision, or expiry/version.
- Acceptance recalculates from current local state, which mitigates stale local slots.
- If Supabase is configured, it recalculates, reserves through an atomic RPC, then `acceptProposal` recalculates a second time. A state/realtime change between RPC acknowledgement and the second calculation can make local bookings differ from the server-reserved proposal.
- Pending proposals exist only in `generatedProposals` memory. They block only the current client and can disappear on state replacement, login switch, or sync reset.

Replacement/duplication:

- `generateSingleProposal` excludes all bookings belonging to the case. This avoids self-collision during regeneration.
- `acceptProposal` then removes **every** same-case booking and inserts fresh bookings with new local IDs. It does not preserve started, paused, completed, or historical bookings.
- Appointment business rules do not prohibit generating/accepting a new appointment after work has started. Acceptance also resets received/work/quality/delivery flags. This is the highest correctness/data-loss risk.
- Repeated local acceptance replaces rather than duplicates the current in-memory set, but new booking IDs can create delete/create reconciliation work in granular sync.
- Server reservation uses a deterministic idempotency key and planning version, reducing duplicate server reservations. The client reads the latest server planning version immediately before RPC rather than proving that the displayed proposal was generated from that version.
- `clearCasePlanning`, reschedule, no-show, and delete remove case bookings. Case close/archive keeps bookings but `isPlanningBlockingBooking` makes closed cases non-blocking. Closed pending proposals are filtered.
- A pending case with any accepted booking is omitted from pending-proposal load because `acceptedCaseIds` is case-wide, regardless of booking status or whether the pending proposal is a genuine reschedule.

Recommended acceptance invariant: never replace productive history implicitly; proposals must carry a version/identity and acceptance must compare-and-swap the exact recalculated plan once, with local state built from the server-acknowledged result.

## 16. Permissions audit

Canonical permissions were not changed.

Guarded paths:

- proposal generation: `guardAppointmentSchedule` / `appointment.schedule`;
- PDF task validation, durations/resource selection, and manual assignment edits: `planning.edit`;
- resource/leave/work-hour edits: `resource.manage` or `planning.edit` as applicable;
- task reschedule and subcontract reserve: `planning.edit`;
- no-show/reschedule: `appointment.schedule`;
- case deletion/archive protections: canonical sensitive guards.

Bypass found:

- proposal accept buttons are rendered without an acceptance-specific permission state;
- `acceptProposalAtomically` and `acceptProposal` do not call `guardAppointmentSchedule` or `guardAction` themselves.

Normal UI proposal creation is guarded and user switching clears generated proposals, which narrows exposure, but callable mutation functions must still enforce canonical permission at the action boundary. Count: **1 acceptance-path bypass class**.

## 17. Offline/concurrency interaction

- Proposal calculation reads current in-memory `state.bookings` plus same-client pending proposals. It does not query IndexedDB, outbox, or Supabase directly.
- Calculation does not insert bookings or call `saveState`, but it does mutate `item.planningColor` on first color assignment and callers store the proposal in in-memory `generatedProposals`.
- With Supabase configured, acceptance while `navigator.onLine === false` is rejected before local booking insertion. The proposal remains unaccepted.
- Without Supabase configuration, atomic reservation returns “skipped” and local acceptance proceeds; there is no cross-workstation protection.
- Online configured acceptance uses `nimr_reserve_planning_atomic`, resource ID resolution, idempotency key, and planning version. Server conflict/version errors force recalculation.
- Another workstation's booking is considered only after it reaches the local `state.bookings`. Pending proposals on that workstation are invisible.
- Open/conflicted outbox operations are not consulted by planner generation as a separate source. If their local entity is still present in `state.bookings`, it affects planning; if conflict resolution removed/replaced it, only current state is seen.
- Local and server plan shape differs for multi-segment work: the RPC sends one reservation row per segment, while local `stepToBooking` stores one booking containing all segments. Reconciliation depends on sync mapping and should be regression-tested before changing segmentation.

## 18. Risks ranked Critical/High/Medium/Low

Critical:

1. Regeneration/acceptance can delete started/completed same-case bookings and reset workflow flags; no state gate prevents it.
2. Atomic server reservation is followed by a second local recalculation, allowing server/local plan divergence after acknowledgement.

High:

1. Non-PDF task dependencies/parallelism are silently rewritten by the PDF normalizer during `normalizeCase`.
2. Planner scale is unusable near the 100k/300k target: 10-task graph reaches ~29 s/~99 s; sequential reaches ~20 s/~63 s.
3. Daily-capacity search skips whole days and fails legitimate long work under default 8-hour days with a 420-minute cap.
4. Graph/PDF path loses bodyworker and painter continuity; case-level manual preferences/locks are ignored.
5. Proposal acceptance lacks a canonical permission guard at the mutation boundary.

Medium:

1. `stepAssignmentLocks` is not a lock; invalid locks silently fall back.
2. Similar business work selects graph or sequential mode based on source/history.
3. Task provenance fields are lost when accepted bookings are created.
4. Same-client pending proposals block capacity but are neither versioned nor shared.
5. Full-case `acceptedCaseIds` suppresses pending load even for reschedule-like situations.
6. Multi-segment local booking vs per-segment server reservation creates reconciliation complexity.

Low:

1. Lexical task IDs influence deterministic ready-task allocation order.
2. Preferred resources behave as hard priority over earlier completion, but the UI/business meaning is undocumented.
3. Historical anticipated-parts documentation remains stale.

## 19. Recommended P1 implementation slices

Priority order considers correctness/data-loss first, then performance, then behavior refinement:

1. **P1-002 — proposal identity, acceptance CAS, and productive-history protection.** Add action-boundary permission guard; proposal/version identity; one recalculation only; reject/explicitly migrate plans for started/completed work; reconcile server-acknowledged plan. Correctness critical, high double-booking/data-loss impact, medium-high implementation risk.
2. **P1-003 — canonical task model and source-aware compatibility.** Separate PDF sequentialization from generic graph normalization; define canonical/legacy migrations; preserve dependencies, parallelism, provenance, and historical booking interpretation. Correctness high, medium implementation risk.
3. **P1-004 — indexed planner booking view.** Use P0-007 case/resource/day/resource-day indexes, proposal-local temporary overlays, and cached load summaries; remove full-array clone/scans from candidate loops. Performance critical, semantics-preserving target, medium implementation risk.
4. **P1-005 — deterministic daily-capacity/long-work semantics.** Define one multi-segment booking versus explicit chunks; search within a day when early start exceeds capacity; derive limits from resource/calendar; cover technician+equipment and local/server representation. Correctness high, medium-high implementation risk.
5. **P1-006 — graph continuity and strict assignment locks.** Apply body/reassembly and prep/paint/finish continuity policy in graph mode; distinguish soft preference from hard lock; fail locks explicitly. Correctness/operational impact high, medium risk.
6. **P1-007 — planner scale regression gate.** Keep deterministic 1k/10k/100k/300k fixtures, bounded CI budgets, candidate-count/index stats, and a separate opt-in full 14-date benchmark. Performance protection, low-medium risk.
7. **P1-008 — documentation and optional anticipated-parts decision.** Retire or rewrite `FLUX_PIECES_NEUVES_PLANNING.md` only after the canonical graph/vehicle semantics are decided. Lower urgency; do not revive historical code implicitly.

## 20. Explicit non-goals

- No production implementation in P1-001.
- No role/permission redesign or mapping change.
- No Supabase concurrency/RPC/schema change.
- No IndexedDB, outbox, granular sync, KPI/dashboard, or React migration change.
- No application of `416c1d1` or any historical planning branch.
- No anticipated-new-parts behavior revival.
- No historical branch cleanup or rewrite.
- No P2 work.

Phase result: analysis and characterization only; stop before commit, push, or PR.
