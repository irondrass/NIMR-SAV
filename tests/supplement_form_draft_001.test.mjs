import assert from "node:assert/strict";
import test from "node:test";
import { withBrowserPage } from "./helpers/cdp_browser_harness.mjs";

const EXPECTED_DRAFT = Object.freeze({
  title: "BRUIT",
  vehicleArea: "ZONE AVANT",
  status: "draft",
  phase: "mechanical",
  reason: "CONTROLE",
  operation: "DIAGNOSTIC BRUIT AVANT",
  laborHours: "1.5",
  parts: "PIECE TEST x1",
});

function fixtureExpression() {
  return `(() => {
    state = normalizeState({
      currentUserId: "admin-p1",
      users: [{
        id: "admin-p1",
        name: "Admin P1",
        role: "admin_technique",
        active: true
      }],
      resources: [],
      bookings: [],
      cases: [
        {
          id: "case-a",
          createdAt: "2026-09-11T08:00:00.000Z",
          clientName: "Client A",
          vehicle: "Vehicule A",
          plate: "111 TU 111",
          flags: { received: true, workStarted: true },
          claims: [],
          supplements: [],
          history: []
        },
        {
          id: "case-b",
          createdAt: "2026-09-11T08:01:00.000Z",
          clientName: "Client B",
          vehicle: "Vehicule B",
          plate: "222 TU 222",
          flags: { received: true, workStarted: true },
          claims: [],
          supplements: [],
          history: []
        }
      ]
    });

    showConfirmModal = async () => true;
    activeCaseId = "case-a";
    activeCaseDetailTab = "claims";
    setActiveTab("dossiers");
    render();

    return {
      activeCaseId,
      formExists: Boolean(document.querySelector("#supplement-form"))
    };
  })()`;
}

function fillDraftExpression(values = EXPECTED_DRAFT) {
  return `(() => {
    const values = ${JSON.stringify(values)};
    const form = document.querySelector("#supplement-form");
    if (!form) throw new Error("supplement form missing");

    const setValue = (name, value, eventType = "input") => {
      const element = form.elements[name];
      if (!element) throw new Error("missing field: " + name);
      element.value = value;
      element.dispatchEvent(new Event(eventType, { bubbles: true }));
    };

    setValue("title", values.title);
    setValue("vehicleArea", values.vehicleArea);
    setValue("status", values.status, "change");
    setValue("phase", values.phase, "change");
    setValue("reason", values.reason);
    setValue("operation", values.operation);
    setValue("laborHours", values.laborHours);
    setValue("parts", values.parts);

    return true;
  })()`;
}

const snapshotExpression = `(() => {
  const form = document.querySelector("#supplement-form");
  if (!form) return null;
  return {
    title: form.elements.title?.value ?? "",
    vehicleArea: form.elements.vehicleArea?.value ?? "",
    status: form.elements.status?.value ?? "",
    phase: form.elements.phase?.value ?? "",
    reason: form.elements.reason?.value ?? "",
    operation: form.elements.operation?.value ?? "",
    laborHours: form.elements.laborHours?.value ?? "",
    parts: form.elements.parts?.value ?? ""
  };
})()`;

test("SUPPLEMENT-FORM-DRAFT-001: unsaved supplement draft survives detail rerenders and clears only after success", async () => {
  await withBrowserPage(process.cwd(), async ({ evaluate, waitFor }) => {
    const fixture = await evaluate(fixtureExpression());

    assert.equal(fixture.activeCaseId, "case-a");
    assert.equal(fixture.formExists, true, "supplement form must exist");

    // ------------------------------------------------------
    // A. Fill all draft fields.
    // ------------------------------------------------------

    await evaluate(fillDraftExpression());

    assert.deepEqual(
      await evaluate(snapshotExpression),
      EXPECTED_DRAFT,
      "fixture must contain the expected unsaved draft before rerender"
    );

    // ------------------------------------------------------
    // B. Global render() must preserve draft.
    //
    // BASELINE v23.3.41 is expected to FAIL here because
    // render() -> renderCaseDetail() recreates the form.
    // ------------------------------------------------------

    await evaluate(`render()`);

    assert.deepEqual(
      await evaluate(snapshotExpression),
      EXPECTED_DRAFT,
      "EXPECTED_P1_FAILURE_RENDER_DRAFT_LOST: global render() must preserve unsaved supplement draft"
    );

    // ------------------------------------------------------
    // C. Direct renderCaseDetail() must also preserve draft.
    // ------------------------------------------------------

    await evaluate(`renderCaseDetail()`);

    assert.deepEqual(
      await evaluate(snapshotExpression),
      EXPECTED_DRAFT,
      "direct renderCaseDetail() must preserve the unsaved supplement draft"
    );

    // ------------------------------------------------------
    // D. Draft from case A must not leak into case B.
    // ------------------------------------------------------

    await evaluate(`
      activeCaseId = "case-b";
      renderCaseDetail();
    `);

    const caseBSnapshot = await evaluate(snapshotExpression);

    assert.deepEqual(
      caseBSnapshot,
      {
        title: "",
        vehicleArea: "",
        status: "draft",
        phase: "body",
        reason: "",
        operation: "",
        laborHours: "",
        parts: ""
      },
      "case A draft must never leak into case B"
    );

    // ------------------------------------------------------
    // E. Return to A and exercise application validation.
    // Invalid submit must preserve entered draft.
    // ------------------------------------------------------

    await evaluate(`
      activeCaseId = "case-a";
      renderCaseDetail();
    `);

    const validationDraft = {
      ...EXPECTED_DRAFT,
      reason: ""
    };

    await evaluate(fillDraftExpression(validationDraft));

    await evaluate(`(() => {
      const form = document.querySelector("#supplement-form");
      form.noValidate = true;
      form.requestSubmit();
      return true;
    })()`);

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.deepEqual(
      await evaluate(snapshotExpression),
      validationDraft,
      "validation failure must preserve the supplement draft"
    );

    assert.equal(
      await evaluate(`state.cases.find((item) => item.id === "case-a").supplements.length`),
      0,
      "invalid supplement must not be persisted"
    );

    // ------------------------------------------------------
    // F. Successful submit creates one supplement and clears
    // the form exactly once.
    // ------------------------------------------------------

    await evaluate(fillDraftExpression());

    await evaluate(`(() => {
      const form = document.querySelector("#supplement-form");
      form.noValidate = false;
      form.requestSubmit();
      return true;
    })()`);

    await waitFor(
      `state.cases.find((item) => item.id === "case-a").supplements.length === 1`,
      5000
    );

    const persisted = await evaluate(`(() => {
      const supplement = state.cases
        .find((item) => item.id === "case-a")
        .supplements[0];

      return {
        title: supplement.title,
        vehicleArea: supplement.vehicleArea,
        status: supplement.status,
        operation: supplement.laborLines?.[0]?.operation || "",
        phase: supplement.laborLines?.[0]?.phase || "",
        laborHours: supplement.laborLines?.[0]?.laborHours ?? null,
        parts: supplement.parts?.map((part) => ({
          designation: part.designation,
          quantity: part.quantity
        })) || []
      };
    })()`);

    assert.equal(persisted.title, EXPECTED_DRAFT.title);
    assert.equal(persisted.vehicleArea, EXPECTED_DRAFT.vehicleArea);
    assert.equal(persisted.status, EXPECTED_DRAFT.status);
    assert.equal(persisted.operation, EXPECTED_DRAFT.operation);
    assert.equal(persisted.phase, EXPECTED_DRAFT.phase);
    assert.equal(Number(persisted.laborHours), 1.5);
    assert.deepEqual(persisted.parts, [
      { designation: "PIECE TEST", quantity: 1 }
    ]);

    const cleared = await evaluate(snapshotExpression);

    assert.deepEqual(
      cleared,
      {
        title: "",
        vehicleArea: "",
        status: "draft",
        phase: "body",
        reason: "",
        operation: "",
        laborHours: "",
        parts: ""
      },
      "successful supplement creation must clear the form"
    );

    // Another rerender must not resurrect the submitted draft.
    await evaluate(`renderCaseDetail()`);

    assert.deepEqual(
      await evaluate(snapshotExpression),
      cleared,
      "submitted draft must remain cleared after rerender"
    );

    assert.equal(
      await evaluate(`state.cases.find((item) => item.id === "case-a").supplements.length`),
      1,
      "successful submit must create exactly one supplement"
    );
  });
});
