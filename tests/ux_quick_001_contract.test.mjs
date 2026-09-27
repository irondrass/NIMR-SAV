import assert from "node:assert/strict";
import fs from "node:fs";

const reception = fs.readFileSync(
  new URL("../js/ui-reception.js", import.meta.url),
  "utf8",
);

const parts = fs.readFileSync(
  new URL("../js/parts-availability-ui.js", import.meta.url),
  "utf8",
);

const cases = fs.readFileSync(
  new URL("../js/ui-cases.js", import.meta.url),
  "utf8",
);

const styles = fs.readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("A QC section progress is rendered", () => {
  assert.match(reception, /data-quality-section-progress/u);
  assert.match(reception, /completedCount/u);
  assert.match(reception, /sectionPoints\.length/u);
});

check("B QC section progress updates live", () => {
  assert.match(
    reception,
    /const qualityInput = e\.target\.closest/u,
  );

  assert.match(
    reception,
    /progress\.textContent/u,
  );

  assert.match(
    reception,
    /\$\{completed\}\/\$\{inputs\.length\}/u,
  );

  assert.match(
    reception,
    /progress\.classList\.toggle\("is-complete", complete\)/u,
  );
});

check("C QC submit exposes pending feedback", () => {
  assert.match(reception, /setQualityPending\(true\)/u);

  assert.match(
    reception,
    /qualitySubmitButton\.setAttribute\("aria-busy", "true"\)/u,
  );

  assert.match(
    reception,
    /qualitySubmitButton\.classList\.toggle\("is-pending", pending\)/u,
  );
});

check("D Parts use semantic status badges", () => {
  assert.match(
    parts,
    /function getPartsAvailabilityStatusClass\(status\)/u,
  );

  assert.match(
    parts,
    /parts-availability-status/u,
  );

  assert.match(
    parts,
    /data-parts-status=/u,
  );
});

check("E Parts save exposes pending feedback", () => {
  assert.match(
    parts,
    /saveButton\.classList\.add\("is-pending"\)/u,
  );

  assert.match(
    parts,
    /saveButton\.setAttribute\("aria-busy", "true"\)/u,
  );
});

check("F Technician action exposes pending feedback", () => {
  assert.match(
    cases,
    /activeButton\.classList\.add\("is-pending"\)/u,
  );

  assert.match(
    cases,
    /activeButton\.setAttribute\("aria-busy", "true"\)/u,
  );

  assert.match(
    cases,
    /previousButtonStates/u,
  );
});

check("G Technician complete action has dedicated class", () => {
  assert.match(
    cases,
    /technician-complete-action/u,
  );

  assert.match(
    styles,
    /\.technician-field-action-dock \.technician-complete-action/u,
  );
});

check("H Parts semantic colors exist", () => {
  assert.match(
    styles,
    /\.parts-availability-status\.status-available/u,
  );

  assert.match(
    styles,
    /\.parts-availability-status\.status-partial/u,
  );

  assert.match(
    styles,
    /\.parts-availability-status\.status-blocked_parts/u,
  );

  assert.match(
    styles,
    /\.parts-availability-status\.status-unchecked/u,
  );
});

check("I QC completion style exists", () => {
  assert.match(
    styles,
    /\.quality-section-progress\.is-complete/u,
  );
});

check("J Busy button spinner exists", () => {
  assert.match(
    styles,
    /button\.is-pending\[aria-busy="true"\]::before/u,
  );

  assert.match(
    styles,
    /@keyframes nimr-action-spin/u,
  );
});

check("K QC pending always clears", () => {
  const start = reception.indexOf("setQualityPending(true);");
  const end = reception.indexOf(
    "delete form.dataset.qualityOperationId;",
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const body = reception.slice(start, end);

  assert.match(body, /finally\s*\{/u);
  assert.match(body, /setQualityPending\(false\)/u);
});

console.log(
  `UX-QUICK-001 CONTRACT: ${passed}/11 CHECKS PASSED`
);