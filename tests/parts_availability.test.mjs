import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(new URL("../js/parts-availability.js", import.meta.url), "utf8"),
  context,
);

const {
  createPartsAvailabilityReview,
  derivePartsStatus,
  projectPartsAvailabilityLines,
  validatePartsAvailabilityReview,
} = context;

const reviewedAt = "2026-09-26T08:30:00.000Z";

function sourcePart(id, designation, quantity = 1) {
  return { id, designation, quantity };
}

function review(overrides = {}) {
  return {
    caseId: "case-001",
    allDelivered: false,
    reviewedBy: "storekeeper-001",
    reviewedAt,
    lines: [
      {
        sourcePartId: "part-001",
        designation: "Pare-chocs avant",
        quantity: 1,
        unavailable: false,
        canBeTaken: null,
      },
    ],
    ...overrides,
  };
}

function check(name, callback) {
  callback();
  console.log(`PASS ${name}`);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

check("projects an all-delivered review without mutating source parts", () => {
  const source = [sourcePart("part-001", "Pare-chocs avant", 1)];
  const snapshot = structuredClone(source);

  const result = createPartsAvailabilityReview({
    caseId: "case-001",
    allDelivered: true,
    reviewedBy: "storekeeper-001",
    reviewedAt,
    lines: source,
  });

  assert.deepEqual(source, snapshot);
  assert.notEqual(result.lines, source);
  assert.notEqual(result.lines[0], source[0]);
  assert.deepEqual(plain(result.lines[0]), {
    sourcePartId: "part-001",
    designation: "Pare-chocs avant",
    quantity: 1,
    unavailable: false,
    canBeTaken: null,
  });
  assert.equal(result.allDelivered, true);
});

check("accepts one unavailable part that can be taken", () => {
  const result = createPartsAvailabilityReview(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: true,
      canBeTaken: true,
    }],
  }));

  assert.equal(result.lines[0].canBeTaken, true);
});

check("accepts one unavailable part that cannot be taken", () => {
  const result = createPartsAvailabilityReview(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: true,
      canBeTaken: false,
      unavailableReason: "Aucun véhicule donneur identifié",
      note: "Relancer le fournisseur",
    }],
  }));

  assert.equal(result.lines[0].canBeTaken, false);
  assert.equal(result.lines[0].unavailableReason, "Aucun véhicule donneur identifié");
  assert.equal(result.lines[0].note, "Relancer le fournisseur");
});

check("keeps available and unavailable parts in the same copied projection", () => {
  const lines = [
    { ...sourcePart("part-001", "Pare-chocs avant"), unavailable: true, canBeTaken: false },
    sourcePart("part-002", "Optique avant droit", 2),
  ];

  const result = createPartsAvailabilityReview(review({ lines }));

  assert.deepEqual(
    plain(result.lines.map((line) => [line.sourcePartId, line.unavailable, line.canBeTaken])),
    [["part-001", true, false], ["part-002", false, null]],
  );
});

check("rejects an unavailable part without canBeTaken", () => {
  const result = validatePartsAvailabilityReview(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: true,
      canBeTaken: null,
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "CAN_BE_TAKEN_REQUIRED"));
});

check("rejects canBeTaken on an available part", () => {
  const result = validatePartsAvailabilityReview(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: false,
      canBeTaken: true,
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "CAN_BE_TAKEN_FORBIDDEN"));
});

check("rejects allDelivered with an unavailable part", () => {
  const result = validatePartsAvailabilityReview(review({
    allDelivered: true,
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: true,
      canBeTaken: false,
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "ALL_DELIVERED_CONFLICT"));
});

check("rejects allDelivered false when no part is unavailable", () => {
  const result = validatePartsAvailabilityReview(review({ allDelivered: false }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "NO_UNAVAILABLE_PART_SELECTED"));
});

check("rejects a negative quantity", () => {
  const result = validatePartsAvailabilityReview(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: -1,
      unavailable: false,
      canBeTaken: null,
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "INVALID_QUANTITY"));
});

check("derives available when all parts are delivered", () => {
  assert.equal(derivePartsStatus(review({ allDelivered: true })), "available");
});

check("derives partial when only some parts are unavailable", () => {
  assert.equal(derivePartsStatus(review({
    lines: [
      {
        sourcePartId: "part-001",
        designation: "Pare-chocs avant",
        quantity: 1,
        unavailable: true,
        canBeTaken: false,
      },
      {
        sourcePartId: "part-002",
        designation: "Optique avant droit",
        quantity: 1,
        unavailable: false,
        canBeTaken: null,
      },
    ],
  })), "partial");
});

check("derives waiting_parts when every required part is unavailable", () => {
  assert.equal(derivePartsStatus(review({
    lines: [
      {
        sourcePartId: "part-001",
        designation: "Pare-chocs avant",
        quantity: 1,
        unavailable: true,
        canBeTaken: true,
      },
      {
        sourcePartId: "part-002",
        designation: "Optique avant droit",
        quantity: 1,
        unavailable: true,
        canBeTaken: false,
      },
    ],
  })), "waiting_parts");
});

check("derives unchecked when no valid review exists", () => {
  assert.equal(derivePartsStatus(null), "unchecked");
  assert.equal(derivePartsStatus(review({
    lines: [{
      sourcePartId: "part-001",
      designation: "Pare-chocs avant",
      quantity: 1,
      unavailable: true,
      canBeTaken: null,
    }],
  })), "unchecked");
});

check("derives unchecked when allDelivered is false and every part is available", () => {
  assert.equal(derivePartsStatus(review({ allDelivered: false })), "unchecked");
});

check("never derives blocked_parts", () => {
  const statuses = [
    derivePartsStatus(null),
    derivePartsStatus(review({ allDelivered: true })),
    derivePartsStatus(review({
      lines: [
        { sourcePartId: "part-001", designation: "A", quantity: 1, unavailable: true, canBeTaken: true },
        { sourcePartId: "part-002", designation: "B", quantity: 1, unavailable: false, canBeTaken: null },
      ],
    })),
    derivePartsStatus(review({
      lines: [{ sourcePartId: "part-001", designation: "A", quantity: 1, unavailable: true, canBeTaken: false }],
    })),
  ];

  assert.deepEqual(statuses, ["unchecked", "available", "partial", "waiting_parts"]);
  assert.equal(statuses.includes("blocked_parts"), false);
});

check("preserves an existing sourcePartId and generates a deterministic fallback", () => {
  const projected = projectPartsAvailabilityLines([
    { sourcePartId: "canonical-001", id: "legacy-001", designation: "A", quantity: 1 },
    { designation: "B", quantity: 2 },
  ]);

  assert.deepEqual(
    plain(projected.map((line) => line.sourcePartId)),
    ["canonical-001", "source-part-2"],
  );
});

check("projects legacy supplement notes to the canonical note field", () => {
  const source = [{
    id: "supplement-part-001",
    designation: "Agrafe complémentaire",
    quantity: 4,
    notes: "Référence à confirmer",
  }];
  const snapshot = structuredClone(source);

  const projected = projectPartsAvailabilityLines(source);

  assert.equal(projected[0].note, "Référence à confirmer");
  assert.deepEqual(source, snapshot);
});

console.log("PRELEVEMENT-AUDIT-001A parts availability: 17/17 PASS");
