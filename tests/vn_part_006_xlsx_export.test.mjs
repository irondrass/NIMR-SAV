import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Load vn-part-ui module
const vnPartUiModule = await import("../js/vn-part-ui.js");
const vnPartUi = vnPartUiModule.default || vnPartUiModule;

test("VN-PART-006 XLSX Export Comprehensive Test Suite", async (t) => {
  const sampleDonors = [
    {
      donor_vin: "VF3XXXXXXXXXXXX01",
      donor_model: "Peugeot 208",
      donor_location: "Parc A - Allée 1",
      active_removals_remaining: 2,
      waiting_replacement_count: 2,
      available_to_restore_count: 0,
      overdue_count: 1,
      can_be_restored_today: false,
      is_fully_restored: false,
      workshop_id: "ws-001",
    },
    {
      donor_vin: "VF3XXXXXXXXXXXX02",
      donor_model: "Peugeot 3008",
      donor_location: "Atelier Mecanique",
      active_removals_remaining: 1,
      waiting_replacement_count: 0,
      available_to_restore_count: 1,
      overdue_count: 0,
      can_be_restored_today: true,
      is_fully_restored: false,
      workshop_id: "ws-001",
    },
    {
      donor_vin: "VF3XXXXXXXXXXXX03",
      donor_model: "Citroen C3",
      donor_location: "Parc VN",
      active_removals_remaining: 0,
      waiting_replacement_count: 0,
      available_to_restore_count: 0,
      overdue_count: 0,
      can_be_restored_today: false,
      is_fully_restored: true,
      workshop_id: "ws-001",
    },
    {
      donor_vin: "VF3XXXXXXXXXXXX04",
      donor_model: "DS 4",
      donor_location: "Showroom",
      active_removals_remaining: 2,
      waiting_replacement_count: 2,
      available_to_restore_count: 0,
      overdue_count: 0,
      can_be_restored_today: false,
      is_fully_restored: false,
      workshop_id: "ws-001",
    },
  ];

  const sampleRemovals = [
    // Physical removal 1 (overdue, waiting replacement)
    {
      id: "rem-001",
      donor_vin: "VF3XXXXXXXXXXXX01",
      donor_model: "Peugeot 208",
      beneficiary_vin: "VF3BBBBBBBBBBBB01",
      beneficiary_model: "Peugeot 208 GT",
      beneficiary_or: "OR-2026-001",
      part_reference: "REF-OPT-01",
      part_designation: "Optique LED Droit",
      quantity: 1,
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-01T10:00:00.000Z",
      expected_replacement_date: "2026-09-10",
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    },
    // Physical removal 1b on donor 1 (missing ETA)
    {
      id: "rem-001b",
      donor_vin: "VF3XXXXXXXXXXXX01",
      donor_model: "Peugeot 208",
      beneficiary_vin: "VF3BBBBBBBBBBBB01",
      beneficiary_model: "Peugeot 208 GT",
      beneficiary_or: "OR-2026-001",
      part_reference: "REF-RAD-01",
      part_designation: "Radiateur de refroidissement",
      quantity: 1,
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-05T08:30:00.000Z",
      expected_replacement_date: null,
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    },
    // Physical removal 2 (ready to restore, replacement available)
    {
      id: "rem-002",
      donor_vin: "VF3XXXXXXXXXXXX02",
      donor_model: "Peugeot 3008",
      beneficiary_vin: "VF3BBBBBBBBBBBB02",
      beneficiary_model: "Peugeot 3008 Allure",
      beneficiary_or: "OR-2026-002",
      part_reference: "REF-CAL-02",
      part_designation: "Calandre avant chromée",
      quantity: 2,
      status: "PIECE_DISPONIBLE",
      removed_at: "2026-09-02T11:00:00.000Z",
      expected_replacement_date: "2026-09-12",
      replacement_available_at: "2026-09-12T14:00:00.000Z",
      restored_at: null,
      version: 2,
      workshop_id: "ws-001",
    },
    // Physical removal 3 (fully restored)
    {
      id: "rem-003",
      donor_vin: "VF3XXXXXXXXXXXX03",
      donor_model: "Citroen C3",
      beneficiary_vin: "VF3BBBBBBBBBBBB03",
      beneficiary_model: "Citroen C3 Shine",
      beneficiary_or: "OR-2026-003",
      part_reference: "REF-RET-03",
      part_designation: "Rétroviseur gauche électrique",
      quantity: 1,
      status: "RESTITUE_AU_VN",
      removed_at: "2026-08-20T08:00:00.000Z",
      expected_replacement_date: "2026-08-25",
      replacement_available_at: "2026-08-25T09:00:00.000Z",
      restored_at: "2026-08-26T16:00:00.000Z",
      version: 3,
      workshop_id: "ws-001",
    },
    // Physical removal 4 (due today: 2026-09-16)
    {
      id: "rem-004-today",
      donor_vin: "VF3XXXXXXXXXXXX04",
      donor_model: "DS 4",
      beneficiary_vin: "VF3BBBBBBBBBBBB04",
      beneficiary_model: "DS 4 Bastille",
      beneficiary_or: "OR-2026-004",
      part_reference: "REF-BAT-04",
      part_designation: "Batterie 12V 70Ah",
      quantity: 1,
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-10T14:00:00.000Z",
      expected_replacement_date: "2026-09-16",
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    },
    // Physical removal 5 (upcoming ETA: 2026-09-25)
    {
      id: "rem-005-upcoming",
      donor_vin: "VF3XXXXXXXXXXXX04",
      donor_model: "DS 4",
      beneficiary_vin: "VF3BBBBBBBBBBBB05",
      beneficiary_model: "DS 4 Rivoli",
      beneficiary_or: "OR-2026-005",
      part_reference: "REF-ECM-05",
      part_designation: "Calculateur BSI",
      quantity: 1,
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-14T09:00:00.000Z",
      expected_replacement_date: "2026-09-25",
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    },
    // Pre-removal request (NOT physically removed yet: removed_at IS NULL)
    {
      id: "rem-006-pre",
      donor_vin: "VF3XXXXXXXXXXXX01",
      donor_model: "Peugeot 208",
      beneficiary_vin: "VF3BBBBBBBBBBBB06",
      beneficiary_model: "Peugeot 208 Active",
      beneficiary_or: "OR-2026-006",
      part_reference: "REF-ALT-06",
      part_designation: "Alternateur 12V",
      quantity: 1,
      status: "AUTORISE_A_PRELEVER",
      removed_at: null,
      expected_replacement_date: null,
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    },
  ];

  await t.test("1. non-physical excluded: removals with removed_at == null are strictly excluded", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    assert.ok(rows.every((r) => r.removed_at !== null && r.removed_at !== undefined));
    assert.equal(rows.some((r) => r.id === "rem-006-pre"), false);
  });

  await t.test("2. all-open parity: export matches visible Section B rows for activeFilter = 'all-open'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });
    assert.equal(rows.length, 5);
    const rowIds = rows.map((r) => r.id);
    assert.ok(rowIds.includes("rem-001"));
    assert.ok(rowIds.includes("rem-001b"));
    assert.ok(rowIds.includes("rem-002"));
    assert.ok(rowIds.includes("rem-004-today"));
    assert.ok(rowIds.includes("rem-005-upcoming"));
    assert.equal(rowIds.includes("rem-003"), false);
  });

  await t.test("3. ready parity: export matches visible Section B rows for activeFilter = 'ready'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "ready",
      searchQuery: "",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "rem-002");
  });

  await t.test("4. overdue parity: export matches visible Section B rows for activeFilter = 'overdue'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "overdue",
      searchQuery: "",
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].donor_vin, "VF3XXXXXXXXXXXX01");
  });

  await t.test("5. waiting parity: export matches visible Section B rows for activeFilter = 'waiting'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "waiting",
      searchQuery: "",
    });
    assert.equal(rows.length, 4);
    const donorVins = new Set(rows.map((r) => r.donor_vin));
    assert.ok(donorVins.has("VF3XXXXXXXXXXXX01"));
    assert.ok(donorVins.has("VF3XXXXXXXXXXXX04"));
    assert.equal(donorVins.has("VF3XXXXXXXXXXXX02"), false);
  });

  await t.test("6. history parity: export matches visible Section B rows for activeFilter = 'history'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "history",
      searchQuery: "",
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "rem-003");
  });

  await t.test("7. search parity: export matches visible Section B rows when search query is applied", () => {
    const searchPartRows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "Optique",
    });
    assert.equal(searchPartRows.length, 2);
    assert.equal(searchPartRows[0].donor_vin, "VF3XXXXXXXXXXXX01");

    const searchVinRows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "VF3XXXXXXXXXXXX02",
    });
    assert.equal(searchVinRows.length, 1);
    assert.equal(searchVinRows[0].id, "rem-002");
  });

  await t.test("8. exact visible ID parity UI vs export: Section B group traversal strictly matches export IDs", () => {
    const filters = ["all-open", "ready", "overdue", "waiting", "history"];
    for (const filter of filters) {
      const filteredDonors = vnPartUi.filterVnPartDonors(sampleDonors, sampleRemovals, filter, "");
      const groups = vnPartUi.groupVnPartByModelAndVin(filteredDonors, sampleRemovals);

      const uiPhysicalIds = [];
      for (const group of groups) {
        for (const item of group.items) {
          const donorRemovals = (item.removals || []).filter((r) => Boolean(r.removed_at));
          for (const rem of donorRemovals) {
            uiPhysicalIds.push(rem.id);
          }
        }
      }

      const exportRows = vnPartUi.getVisiblePhysicalRemovalRows({
        donors: sampleDonors,
        removals: sampleRemovals,
        activeFilter: filter,
        searchQuery: "",
      });
      const exportIds = exportRows.map((r) => r.id);

      assert.deepEqual(
        exportIds,
        uiPhysicalIds,
        `Export physical IDs must match UI physical IDs for filter '${filter}'`
      );
    }
  });

  await t.test("9. exact 17-column order: workbook headers match approved contract exactly", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    const expectedHeaders = [
      "Statut",
      "VIN donneur",
      "Modèle donneur",
      "Emplacement donneur",
      "VIN bénéficiaire",
      "Modèle bénéficiaire",
      "N° OR",
      "Référence pièce",
      "Désignation pièce",
      "Quantité",
      "Date prélèvement",
      "ETA remplacement",
      "État ETA",
      "Jours de retard",
      "Pièce de remplacement disponible",
      "Date disponibilité",
      "Date restitution",
    ];

    const colLetters = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q"];
    assert.equal(expectedHeaders.length, 17);

    for (let i = 0; i < expectedHeaders.length; i++) {
      const cell = ws[`${colLetters[i]}1`];
      assert.ok(cell, `header cell ${colLetters[i]}1 must exist`);
      assert.equal(cell.v, expectedHeaders[i]);
    }
  });

  await t.test("10. numeric quantity: column 10 (Quantité) is cell type 'n'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-002") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const qtyCell = ws[`J${rowIdx}`];
    assert.ok(qtyCell);
    assert.equal(qtyCell.t, "n", "Quantité cell must have numeric type 'n'");
    assert.equal(qtyCell.v, 2, "Quantité cell value must equal 2");
  });

  await t.test("11. numeric overdue days: column 14 (Jours de retard) is cell type 'n' when applicable", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-001") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const overdueCell = ws[`N${rowIdx}`];
    assert.ok(overdueCell);
    assert.equal(overdueCell.t, "n", "Jours de retard must have numeric type 'n' when overdue");
    assert.equal(overdueCell.v, 6, "Jours de retard must be numeric 6");
  });

  await t.test("12. ETA missing: row with missing ETA outputs 'ETA MANQUANTE'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-001b") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const etaStateCell = ws[`M${rowIdx}`];
    assert.ok(etaStateCell);
    assert.equal(etaStateCell.v, "ETA MANQUANTE");
  });

  await t.test("13. ETA due today: row due today outputs 'ÉCHÉANCE AUJOURD\\'HUI'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-004-today") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const etaStateCell = ws[`M${rowIdx}`];
    assert.ok(etaStateCell);
    assert.equal(etaStateCell.v, "ÉCHÉANCE AUJOURD'HUI");
  });

  await t.test("14. ETA overdue: row overdue outputs 'ETA DÉPASSÉE (D+6)'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-001") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const etaStateCell = ws[`M${rowIdx}`];
    assert.ok(etaStateCell);
    assert.equal(etaStateCell.v, "ETA DÉPASSÉE (D+6)");
  });

  await t.test("15. ETA upcoming: row with future ETA outputs 'ETA À VENIR'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-005-upcoming") {
        rowIdx = i + 2;
        break;
      }
    }
    assert.ok(rowIdx > 1);
    const etaStateCell = ws[`M${rowIdx}`];
    assert.ok(etaStateCell);
    assert.equal(etaStateCell.v, "ETA À VENIR");
  });

  await t.test("16. replacement available yes/no: column 15 displays 'OUI' or 'NON'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });

    const wb = vnPartUi.buildVnPartExportWorkbook(rows, { todayIso: "2026-09-16" });
    const ws = wb.Sheets["Prélèvements"];

    let rowIdx2 = -1;
    let rowIdx1 = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].id === "rem-002") rowIdx2 = i + 2;
      if (rows[i].id === "rem-001") rowIdx1 = i + 2;
    }
    assert.equal(ws[`O${rowIdx2}`].v, "OUI");
    assert.equal(ws[`O${rowIdx1}`].v, "NON");
  });

  await t.test("17. empty visible set => no workbook: zero visible rows aborts generation", () => {
    let notified = null;
    const res = vnPartUi.exportVnPartToExcel({
      rows: [],
      notifyUser: (msg) => { notified = msg; },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "EMPTY_EXPORT");
    assert.match(notified, /Aucun prélèvement physique visible/);
  });

  await t.test("18. worksheet name: sheet is named 'Prélèvements'", () => {
    const rows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "",
    });
    const wb = vnPartUi.buildVnPartExportWorkbook(rows);
    assert.equal(wb.SheetNames[0], "Prélèvements");
  });

  await t.test("19. filename contract: matches Etat_prelevements_YYYY-MM-DD_HHmm.xlsx", () => {
    const testDate = new Date("2026-09-16T14:25:00.000Z");
    const name = vnPartUi.generateVnPartExportFilename(testDate);
    assert.match(name, /^Etat_prelevements_\d{4}-\d{2}-\d{2}_\d{4}\.xlsx$/);
  });

  await t.test("20. Section B canonical selection pipeline: actual rendered Section-B removal IDs match export IDs across all filters and search", () => {
    // Setup mock DOM container for renderVnPartView
    const container = { innerHTML: "", id: "vn-part-content" };
    const elements = new Map([
      ["vn-part-content", container],
      ["vn-part-kpi-remaining", { textContent: "" }],
      ["vn-part-kpi-unreturned", { textContent: "" }],
      ["vn-part-kpi-ready", { textContent: "" }],
      ["vn-part-kpi-overdue", { textContent: "" }],
      ["vn-part-new-request-btn", { style: {} }],
      ["vn-part-conflict-banner", { style: {} }],
      ["vn-part-conflict-message", { textContent: "" }],
    ]);

    globalThis.document = {
      getElementById: (id) => elements.get(id) || null,
      querySelector: (sel) => elements.get(sel.replace(/^[.#]/, "")) || null,
      querySelectorAll: () => [],
      createElement: () => ({ innerHTML: "", setAttribute() {}, appendChild() {} }),
      addEventListener: () => {},
    };

    vnPartUi.vnPartEphemeralState.donors = sampleDonors;
    vnPartUi.vnPartEphemeralState.removals = sampleRemovals;

    const testFilters = ["all-open", "ready", "overdue", "waiting", "history"];
    for (const filter of testFilters) {
      vnPartUi.vnPartEphemeralState.activeFilter = filter;
      vnPartUi.vnPartEphemeralState.searchQuery = "";

      vnPartUi.renderVnPartView();

      // Extract rendered Section B physical removal IDs from actual rendered HTML
      const renderedRemovalMatches = [
        ...container.innerHTML.matchAll(/class="vn-part-removal-item"[^>]*data-id="([^"]+)"/g),
      ].map((m) => m[1]);

      const exportRows = vnPartUi.getVisiblePhysicalRemovalRows({
        donors: sampleDonors,
        removals: sampleRemovals,
        activeFilter: filter,
        searchQuery: "",
      });
      const exportIds = exportRows.map((r) => r.id);

      assert.deepEqual(
        renderedRemovalMatches,
        exportIds,
        `Rendered Section B removal IDs must match export source IDs for filter '${filter}'`
      );
    }

    // Search query test
    vnPartUi.vnPartEphemeralState.activeFilter = "all-open";
    vnPartUi.vnPartEphemeralState.searchQuery = "Optique";
    vnPartUi.renderVnPartView();

    const searchRenderedIds = [
      ...container.innerHTML.matchAll(/class="vn-part-removal-item"[^>]*data-id="([^"]+)"/g),
    ].map((m) => m[1]);

    const searchExportRows = vnPartUi.getVisiblePhysicalRemovalRows({
      donors: sampleDonors,
      removals: sampleRemovals,
      activeFilter: "all-open",
      searchQuery: "Optique",
    });
    const searchExportIds = searchExportRows.map((r) => r.id);

    assert.deepEqual(
      searchRenderedIds,
      searchExportIds,
      "Rendered Section B removal IDs must match export source IDs under search query"
    );
  });

  await t.test("21. Section B Exporter Excel button: exists in rendered HTML and triggers export with canonical visible rows", () => {
    const makeElement = (id) => ({
      id,
      innerHTML: "",
      textContent: "",
      style: {},
      addEventListener: () => {},
      closest: (sel) => (sel === `#${id}` ? this : null),
    });

    const container = makeElement("vn-part-content");
    const elements = new Map([
      ["vn-part-content", container],
      ["vn-part-kpi-remaining", makeElement("vn-part-kpi-remaining")],
      ["vn-part-kpi-unreturned", makeElement("vn-part-kpi-unreturned")],
      ["vn-part-kpi-ready", makeElement("vn-part-kpi-ready")],
      ["vn-part-kpi-overdue", makeElement("vn-part-kpi-overdue")],
      ["vn-part-new-request-btn", makeElement("vn-part-new-request-btn")],
      ["vn-part-conflict-banner", makeElement("vn-part-conflict-banner")],
      ["vn-part-conflict-message", makeElement("vn-part-conflict-message")],
      ["vn-part-search-input", makeElement("vn-part-search-input")],
      ["vn-part-refresh-btn", makeElement("vn-part-refresh-btn")],
    ]);

    const clickListeners = [];
    globalThis.document = {
      getElementById: (id) => elements.get(id) || makeElement(id),
      querySelector: (sel) => elements.get(sel.replace(/^[.#]/, "")) || makeElement(sel.replace(/^[.#]/, "")),
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      addEventListener: (type, fn) => {
        if (type === "click") clickListeners.push(fn);
      },
    };

    vnPartUi.vnPartEphemeralState.donors = sampleDonors;
    vnPartUi.vnPartEphemeralState.removals = sampleRemovals;
    vnPartUi.vnPartEphemeralState.activeFilter = "ready";
    vnPartUi.vnPartEphemeralState.searchQuery = "";

    vnPartUi.renderVnPartView();

    // 1. Verify "Exporter Excel" button exists in rendered Section B HTML
    assert.match(container.innerHTML, /id="vn-part-export-excel-btn"/, "Section B must render Exporter Excel button");
    assert.match(container.innerHTML, /Exporter Excel/, "Button must display 'Exporter Excel'");

    // 2. Bind UI events and verify click triggers exportVnPartToExcel with exact visible rows
    globalThis.vnPartUi = vnPartUi;
    vnPartUi.bindVnPartUiEvents();
    assert.ok(clickListeners.length > 0, "Click listeners must be bound by bindVnPartUiEvents");

    // Intercept exportVnPartToExcel
    let exportedRows = null;
    const originalExport = vnPartUi.exportVnPartToExcel;
    vnPartUi.exportVnPartToExcel = ({ rows }) => {
      exportedRows = rows;
      return { ok: true };
    };

    try {
      const mockExportBtn = {
        closest: (sel) => (sel === "#vn-part-export-excel-btn" ? mockExportBtn : null),
      };
      for (const fn of clickListeners) {
        fn({ target: mockExportBtn });
      }

      assert.ok(exportedRows, "Clicking Exporter Excel button must invoke exportVnPartToExcel");
      assert.equal(exportedRows.length, 1, "Exported rows must match visible rows for 'ready' filter");
      assert.equal(exportedRows[0].id, "rem-002", "Exported row must be the ready removal rem-002");
    } finally {
      vnPartUi.exportVnPartToExcel = originalExport;
    }
  });

  await t.test("22. Timezone & calendar boundary: classifyEtaTracking uses local calendar semantics without duplicate arithmetic", () => {
    const removalOverdue = {
      id: "rem-tz-1",
      status: "PRELEVE_EN_ATTENTE_PIECE",
      expected_replacement_date: "2026-09-10",
      removed_at: "2026-09-01T00:00:00Z",
    };
    const removalToday = {
      id: "rem-tz-2",
      status: "PRELEVE_EN_ATTENTE_PIECE",
      expected_replacement_date: "2026-09-16",
      removed_at: "2026-09-01T00:00:00Z",
    };
    const removalUpcoming = {
      id: "rem-tz-3",
      status: "PRELEVE_EN_ATTENTE_PIECE",
      expected_replacement_date: "2026-09-20",
      removed_at: "2026-09-01T00:00:00Z",
    };

    const c1 = vnPartUi.classifyEtaTracking(removalOverdue, "2026-09-16");
    assert.equal(c1.category, "OVERDUE");
    assert.equal(c1.daysFromEta, 6);

    const c2 = vnPartUi.classifyEtaTracking(removalToday, "2026-09-16");
    assert.equal(c2.category, "DUE_TODAY");
    assert.equal(c2.daysFromEta, 0);

    const c3 = vnPartUi.classifyEtaTracking(removalUpcoming, "2026-09-16");
    assert.equal(c3.category, "UPCOMING");
    assert.equal(c3.daysFromEta, -4);
  });

  await t.test("23. XLSX formula-safety characterization: dangerous formula strings stored as literal string cells", () => {
    const dangerousRemoval = {
      id: "rem-formula-injection",
      donor_vin: "=2+2",
      donor_model: "+SUM(1,2)",
      donor_location: "-10+20",
      beneficiary_vin: "@SUM(1,1)",
      beneficiary_model: "=HYPERLINK(\"http://evil.com\",\"Click\")",
      beneficiary_or: "+CMD",
      part_reference: "-1+2",
      part_designation: "@EVIL",
      quantity: 1,
      status: "PRELEVE_EN_ATTENTE_PIECE",
      removed_at: "2026-09-01T10:00:00.000Z",
      expected_replacement_date: null,
      replacement_available_at: null,
      restored_at: null,
      version: 1,
      workshop_id: "ws-001",
    };

    const wb = vnPartUi.buildVnPartExportWorkbook([dangerousRemoval], { todayIso: "2026-09-16" });
    const sheetName = wb.SheetNames[0];
    assert.equal(sheetName, "Prélèvements");

    const ws = wb.Sheets[sheetName];
    assert.ok(ws, "Worksheet must exist");

    const dangerousChecks = [
      { col: "B", field: "donor_vin", val: "=2+2" },
      { col: "C", field: "donor_model", val: "+SUM(1,2)" },
      { col: "D", field: "donor_location", val: "-10+20" },
      { col: "E", field: "beneficiary_vin", val: "@SUM(1,1)" },
      { col: "F", field: "beneficiary_model", val: "=HYPERLINK(\"http://evil.com\",\"Click\")" },
      { col: "G", field: "beneficiary_or", val: "+CMD" },
      { col: "H", field: "part_reference", val: "-1+2" },
      { col: "I", field: "part_designation", val: "@EVIL" },
    ];

    for (const { col, field, val } of dangerousChecks) {
      const cellRef = `${col}2`;
      const cell = ws[cellRef];
      assert.ok(cell, `Cell ${cellRef} (${field}) must exist`);
      assert.equal(cell.t, "s", `Cell ${cellRef} (${field}) type must be string ('s')`);
      assert.equal(cell.f, undefined, `Cell ${cellRef} (${field}) formula (.f) must be undefined`);
      assert.equal(cell.v, val, `Cell ${cellRef} (${field}) value (.v) must equal original literal value`);
    }
  });
});

