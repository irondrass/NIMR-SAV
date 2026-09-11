import assert from "node:assert/strict";
import test from "node:test";
import { withBrowserPage } from "./helpers/cdp_browser_harness.mjs";

test("PRINT-07: demonstration supplementary work order fits on 1 A4 portrait page without clipping", async () => {
  await withBrowserPage(process.cwd(), async ({ send, sessionId, evaluate }) => {
    // 1. Inject demonstration state and supplement work order into the browser application
    const printHtml = await evaluate(`(() => {
      let capturedHtml = "";
      const originalOpen = window.open;
      window.open = () => ({
        document: {
          write: (html) => { capturedHtml += html; },
          close: () => {}
        }
      });

      state = normalizeState({
        currentUserId: "chef",
        users: [{ id: "chef", name: "Chef d'atelier", role: "chef_atelier", active: true }],
        resources: [
          { id: "tech", name: "Technicien démonstration", role: "mecanicien", active: true },
          { id: "bridge", name: "Pont démonstration", role: "pont_mecanique", active: true }
        ],
        cases: [{
          id: "case-demo",
          clientName: "Client démonstration",
          phone: "PHONE-SECRET",
          insurance: "INSURANCE-SECRET",
          orNavNumber: "OR-DEMO-040",
          plate: "123 TU 456",
          vehicle: "Véhicule démonstration",
          visitReason: "Bruit au freinage à froid",
          blockerDetails: "Vérifier la fixation avant essai",
          flags: { received: true },
          claims: [{
            id: "claim-1",
            type: "client",
            title: "Intervention",
            estimate: {
              lines: [{ id: "line-1", phase: "mechanical", operation: "Contrôler le freinage et ses fixations", laborHours: 1.5 }],
              parts: [{ designation: "Plaquettes de frein", quantity: 1, unitPrice: 10, amount: 10 }]
            }
          }],
          supplements: [{
            id: "supplement-1",
            number: "SUPP-01",
            title: "Recherche complémentaire",
            reason: "Contrôle à froid",
            vehicleArea: "Train avant",
            integrated: false,
            parts: [],
            laborLines: [{ phase: "mechanical", operation: "Investigation complémentaire", laborHours: 0.5 }]
          }]
        }]
      });

      try {
        printSupplementWorkOrders(state.cases[0]);
      } finally {
        window.open = originalOpen;
      }
      return capturedHtml;
    })()`);

    assert.ok(printHtml && printHtml.length > 0, "print HTML must be generated");

    // 2. Load the generated print document into the browser page
    await evaluate(`(() => {
      document.open();
      document.write(${JSON.stringify(printHtml)});
      document.close();
    })()`);

    // 3. Verify content invariants & layout boundaries in DOM
    const layout = await evaluate(`(() => {
      const body = document.body;
      const text = body.innerText || body.textContent || "";
      const hasHorizontalOverflow = body.scrollWidth > body.clientWidth;
      const notesBox = document.querySelector(".notes-box");
      const signatureGrid = document.querySelector(".signature-grid");
      const signatureBoxes = document.querySelectorAll(".signature-box");

      return {
        hasHorizontalOverflow,
        hasHeaderReference: text.includes("OR-DEMO-040"),
        hasClient: text.includes("Client démonstration"),
        hasPlate: text.includes("123 TU 456"),
        hasDiscoveredDamage: text.includes("Contrôle à froid"),
        hasPartsSection: text.includes("Pièces complémentaires"),
        hasLaborSection: text.includes("Main-d’œuvre complémentaire"),
        hasObservationsSection: text.includes("Observations technicien") && notesBox !== null,
        hasTechnicianSignature: text.includes("Signature technicien"),
        hasWorkshopValidation: text.includes("Validation chef atelier") || text.includes("Validation responsable atelier"),
        signatureBoxesCount: signatureBoxes.length
      };
    })()`);

    // Invariant assertions: no content clipping or loss
    assert.equal(layout.hasHorizontalOverflow, false, "document must have no horizontal overflow");
    assert.equal(layout.hasHeaderReference, true, "header OR reference must be present");
    assert.equal(layout.hasClient, true, "client name must be present");
    assert.equal(layout.hasPlate, true, "vehicle plate must be present");
    assert.equal(layout.hasDiscoveredDamage, true, "discovered damage / reason must be present");
    assert.equal(layout.hasPartsSection, true, "parts section must be present");
    assert.equal(layout.hasLaborSection, true, "labor section must be present");
    assert.equal(layout.hasObservationsSection, true, "observations section must be present with notes box");
    assert.equal(layout.hasTechnicianSignature, true, "technician signature block must be present");
    assert.equal(layout.hasWorkshopValidation, true, "workshop validation signature block must be present");
    assert.equal(layout.signatureBoxesCount, 2, "dual signature boxes must be present");

    // 4. Measure exact A4 portrait print pagination via Chrome DevTools Protocol
    const pdfResult = await send("Page.printToPDF", {
      paperWidth: 8.27, // A4 width in inches (210mm)
      paperHeight: 11.69, // A4 height in inches (297mm)
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      printBackground: true,
      preferCSSPageSize: true
    }, sessionId);

    const pdfBuffer = Buffer.from(pdfResult.data, "base64");
    const pdfString = pdfBuffer.toString("latin1");
    const pageMatches = pdfString.match(/\/Type\s*\/Page\b/g);
    const pageCount = pageMatches ? pageMatches.length : 0;

    // 5. Target contract assertion: Demonstration supplement work order must fit on ONE page
    assert.equal(
      pageCount,
      1,
      `PRINT-07 demonstration supplement work order must fit on 1 A4 portrait page, but produced ${pageCount} pages`
    );
  });
});
