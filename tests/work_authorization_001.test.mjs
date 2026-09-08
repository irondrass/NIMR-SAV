import assert from "node:assert/strict";
import test from "node:test";

import { createNimrVmContext } from "./helpers/nimr_vm_context.mjs";

function createFixture() {
  const { context, run } = createNimrVmContext();

  context.fixture = {
    id: "work-auth-bypass",
    plate: "123 TU 4567",
    clientName: "Client",
    vehicle: "NIMR",
    flags: {
      received: true,
      workStarted: false,
      workCompleted: false,
    },
    claims: [
      {
        id: "order",
        number: "OR-001",
        title: "Alternateur",
        type: "client",
        status: "approved",
        includeInPlanning: true,
        clientApproved: false,
        authorizationReference: "",
        estimate: {
          lines: [
            {
              phase: "mechanical",
              operation: "Remplacer alternateur",
              laborHours: 1,
            },
          ],
        },
      },
    ],
  };

  run(`
    state = normalizeState({
      users: [
        {
          id: "front",
          name: "Reception",
          role: "reception",
          active: true
        },
        {
          id: "worker",
          name: "Technicien",
          role: "technicien",
          resourceId: "tech",
          active: true
        }
      ],
      currentUserId: "front",
      cases: [fixture],
      resources: [
        {
          id: "tech",
          name: "Technicien",
          role: "mecanicien",
          active: true
        }
      ],
      bookings: [
        {
          id: "booking-1",
          caseId: "work-auth-bypass",
          resourceId: "tech",
          type: "work",
          status: "planned",
          start: "2026-09-08T08:00:00.000Z",
          end: "2026-09-08T09:00:00.000Z"
        }
      ]
    });
  `);

  return {
    context,
    run,
    item: run("state.cases[0]"),
    booking: run("state.bookings[0]"),
  };
}

test("imported approved status is not explicit work consent", () => {
  const { context, item } = createFixture();

  assert.equal(
    context.getWorkAuthorizationIssues(item).length,
    1,
    "imported approved status must remain unauthorized",
  );

  assert.equal(
    item.claims[0].authorizationReference || "",
    "",
    "no authorization proof exists initially",
  );
});

test("legacy clientApproved path cannot satisfy authorization without proof", () => {
  const { context, run, item } = createFixture();

  assert.equal(
    run(
      'guardWorkflowAction("clientApproved", state.cases[0], true, { notify: false }).ok'
    ),
    true,
    "Reception can reach the legacy clientApproved control",
  );

  const result = context.applyWorkflowAction(item, "clientApproved");

  assert.equal(
    result.ok,
    true,
    "reproduction requires the legacy mutation to be reachable",
  );

  assert.equal(
    item.claims[0].authorizationReference || "",
    "",
    "legacy mutation supplied no authorization evidence",
  );

  assert.equal(
    item.claims[0].clientApproved,
    true,
    "legacy workflow action sets claim.clientApproved",
  );

  assert.equal(
    item.flags.clientApproved,
    true,
    "legacy workflow aggregate item.flags.clientApproved is set",
  );

  assert.ok(
    context.getWorkAuthorizationIssues(item).length > 0,
    "clientApproved without authorizationReference must remain blocked: LEGACY APPROVAL != EXECUTION AUTHORIZATION",
  );
});

test("work start remains blocked after legacy approval without evidence", () => {
  const { context, item, booking } = createFixture();

  const result = context.applyWorkflowAction(item, "clientApproved");

  assert.equal(result.ok, true);

  const issues = context.getBusinessRuleIssues(
    item,
    "workStarted",
    { booking },
  );

  assert.ok(
    issues.some((message) => /accord|autorisation|autorisé/i.test(message)),
    "workStarted must still report missing work authorization evidence",
  );
});

test("revocation invalidates authorization and clears active proof against reactivation", () => {
  const { context, run, item } = createFixture();

  // 1. Record explicit authorization with evidence
  const authResult = context.recordWorkAuthorization(item, "order", "OR-SIGNE-001");
  assert.equal(authResult.ok, true, "explicit authorization with reference succeeds");
  assert.equal(context.getWorkAuthorizationIssues(item).length, 0, "no authorization issues remaining");

  // 2. Revocation invalidates authorization
  context.clearWorkAuthorization(item.claims[0]);
  context.refreshCaseApprovalFlagsFromClaims(item);
  assert.equal(context.getWorkAuthorizationIssues(item).length, 1, "revocation makes claim unauthorized");
  assert.equal(item.claims[0].authorizationReference, "", "authorizationReference cleared on revocation");
  assert.equal(item.claims[0].clientApproved, false, "claim clientApproved cleared on revocation");

  // 3. Setting legacy clientApproved alone afterward does NOT restore authorization
  context.applyWorkflowAction(item, "clientApproved");
  assert.equal(item.claims[0].clientApproved, true, "legacy action set clientApproved boolean");
  assert.equal(item.claims[0].authorizationReference, "", "reference remains empty");
  assert.equal(item.flags.clientApproved, true, "legacy flag reflects workflow approval");
  assert.equal(context.getWorkAuthorizationIssues(item).length, 1, "claim remains unauthorized without proof");

  // 4. New explicit recordWorkAuthorization with evidence restores authorization
  const reAuthResult = context.recordWorkAuthorization(item, "order", "OR-SIGNE-002");
  assert.equal(reAuthResult.ok, true, "re-authorization succeeds");
  assert.equal(context.getWorkAuthorizationIssues(item).length, 0, "authorization issues cleared with new proof");
});
