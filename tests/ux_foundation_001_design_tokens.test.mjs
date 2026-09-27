import assert from "node:assert/strict";
import fs from "node:fs";

const styles = fs.readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

const foundationTokens = {
  "--font-body": "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--font-heading": "Outfit, Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  "--text-xs": "0.75rem",
  "--text-sm": "0.875rem",
  "--text-base": "1rem",
  "--text-lg": "1.125rem",
  "--text-xl": "1.25rem",
  "--text-2xl": "1.5rem",
  "--space-1": "4px",
  "--space-2": "8px",
  "--space-3": "12px",
  "--space-4": "16px",
  "--space-6": "24px",
  "--space-8": "32px",
  "--line-focus": "#94a3b8",
  "--panel": "#ffffff",
  "--primary": "#004085",
  "--shadow-md": "0 4px 6px -1px rgba(0,0,0,0.07)",
  "--surface-soft": "#f6fafc"
};

const targeted = [
  {
    "baseLine": 880,
    "selector": ".risk-attention",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 895,
    "selector": ".risk-attention .risk-pill",
    "property": "color",
    "expected": "color: var(--warn-text);"
  },
  {
    "baseLine": 985,
    "selector": ".workshop-live-technician-card.status-paused",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 1318,
    "selector": ".technician-task-card.task-status-quality_pending",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 1435,
    "selector": ".workshop-field-card.warn",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 1890,
    "selector": ".tag.priority-attention",
    "property": "color",
    "expected": "color: var(--warn-text);"
  },
  {
    "baseLine": 2716,
    "selector": ".account-source-badge.local",
    "property": "color",
    "expected": "color: var(--muted);"
  },
  {
    "baseLine": 2820,
    "selector": ".account-access-issues",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 3087,
    "selector": ".sav-kpi-card.warn",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 3128,
    "selector": ".sav-load-card.warn",
    "property": "border-left-color",
    "expected": "border-left-color: var(--accent);"
  },
  {
    "baseLine": 3902,
    "selector": "[tabindex]:focus-visible",
    "property": "outline",
    "expected": "outline: 3px solid var(--warn);"
  },
  {
    "baseLine": 3916,
    "selector": ".touch-action-btn:focus-visible",
    "property": "outline-color",
    "expected": "outline-color: var(--warn);"
  },
  {
    "baseLine": 4113,
    "selector": ".pilotage-alert.warn",
    "property": "border-color",
    "expected": "border-color: var(--accent);"
  },
  {
    "baseLine": 4114,
    "selector": ".pilotage-alert.danger",
    "property": "border-color",
    "expected": "border-color: var(--danger);"
  },
  {
    "baseLine": 4689,
    "selector": ".task-status-started .task-status-pill",
    "property": "background",
    "expected": "background: var(--brand-light);"
  },
  {
    "baseLine": 4829,
    "selector": ".technician-override-field span",
    "property": "color",
    "expected": "color: var(--brand);"
  },
  {
    "baseLine": 5089,
    "selector": ".offline-banner strong",
    "property": "color",
    "expected": "color: var(--warn-text);"
  },
  {
    "baseLine": 5807,
    "selector": ".validated-plan-row.anticipated-new-part-row",
    "property": "border-left",
    "expected": "border-left: 4px solid var(--accent);"
  },
  {
    "baseLine": 6589,
    "selector": ".step-option-warning",
    "property": "border-color",
    "expected": "color: var(--accent-text); border-color: var(--accent);"
  },
  {
    "baseLine": 6593,
    "selector": ".step-option-danger",
    "property": "color,border-color",
    "expected": "color: var(--danger); border-color: var(--danger);"
  },
  {
    "baseLine": 7076,
    "selector": ".case-filter-details",
    "property": "background",
    "expected": "background: var(--soft);"
  },
  {
    "baseLine": 7103,
    "selector": ".case-filter-badge",
    "property": "background",
    "expected": "background: var(--brand-light);"
  },
  {
    "baseLine": 7269,
    "selector": ".planning-date-field input[type=\"date\"]",
    "property": "background",
    "expected": "background: var(--soft);"
  },
  {
    "baseLine": 7326,
    "selector": ".planning-filter-badge",
    "property": "background",
    "expected": "background: var(--brand-light);"
  },
  {
    "baseLine": 7460,
    "selector": ".pilotage-priority-card.severity-critical",
    "property": "border-left-color",
    "expected": "border-left-color: var(--danger); background: #fffafa;"
  },
  {
    "baseLine": 7486,
    "selector": ".severity-badge.critical",
    "property": "background",
    "expected": "background: var(--danger-light); color: #991b1b;"
  },
  {
    "baseLine": 7519,
    "selector": ".load-bar-wrap",
    "property": "background",
    "expected": "background: var(--line);"
  },
  {
    "baseLine": 8710,
    "selector": ".cockpit-client-name",
    "property": "color",
    "expected": "color: var(--ink);"
  },
  {
    "baseLine": 8730,
    "selector": ".client-vehicle-summary-grid",
    "property": "background",
    "expected": "background: var(--soft);"
  },
  {
    "baseLine": 8731,
    "selector": ".client-vehicle-summary-grid",
    "property": "border",
    "expected": "border: 1px solid var(--line);"
  },
  {
    "baseLine": 8753,
    "selector": ".client-info-block .info-value, .vehicle-info-block .info-value",
    "property": "color",
    "expected": "color: var(--ink);"
  },
  {
    "baseLine": 8779,
    "selector": ".client-situation-badges span",
    "property": "border",
    "expected": "border: 1px solid var(--line);"
  },
  {
    "baseLine": 8792,
    "selector": ".operational-case-footer",
    "property": "border-top",
    "expected": "border-top: 1px solid var(--line);"
  },
  {
    "baseLine": 9069,
    "selector": ".vn-part-location-badge",
    "property": "background",
    "expected": "background: var(--line);"
  },
  {
    "baseLine": 9105,
    "selector": ".vn-part-badge.badge-overdue",
    "property": "background",
    "expected": "background: var(--danger-light);"
  },
  {
    "baseLine": 9111,
    "selector": ".vn-part-badge.badge-ready",
    "property": "background",
    "expected": "background: var(--ok-light);"
  },
  {
    "baseLine": 9117,
    "selector": ".vn-part-badge.badge-waiting",
    "property": "background",
    "expected": "background: var(--warn-light);"
  },
  {
    "baseLine": 9129,
    "selector": ".vn-part-badge.badge-restored",
    "property": "background",
    "expected": "background: var(--brand-light);"
  },
  {
    "baseLine": 9136,
    "selector": ".vn-part-badge.badge-neutral",
    "property": "color",
    "expected": "color: var(--muted);"
  },
  {
    "baseLine": 9137,
    "selector": ".vn-part-badge.badge-neutral",
    "property": "border",
    "expected": "border: 1px solid var(--line);"
  },
  {
    "baseLine": 9186,
    "selector": ".vn-part-restored-banner svg",
    "property": "stroke",
    "expected": "stroke: var(--ok);"
  },
  {
    "baseLine": 9241,
    "selector": ".vn-part-part-ref",
    "property": "background",
    "expected": "background: var(--line);"
  },
  {
    "baseLine": 9250,
    "selector": ".vn-part-qty",
    "property": "color",
    "expected": "color: var(--muted);"
  },
  {
    "baseLine": 9318,
    "selector": ".vn-part-spinner",
    "property": "border",
    "expected": "border: 3px solid var(--line);"
  },
  {
    "baseLine": 9406,
    "selector": ".vn-part-conflict-banner svg",
    "property": "stroke",
    "expected": "stroke: var(--danger);"
  },
  {
    "baseLine": 9464,
    "selector": ".vn-part-approval-pill",
    "property": "border",
    "expected": "border: 1px solid var(--line);"
  },
  {
    "baseLine": 9465,
    "selector": ".vn-part-approval-pill",
    "property": "color",
    "expected": "color: var(--muted);"
  },
  {
    "baseLine": 9484,
    "selector": ".vn-part-approval-pill.status-refused",
    "property": "background",
    "expected": "background: var(--danger-light);"
  },
  {
    "baseLine": 9494,
    "selector": ".vn-part-approval-pill.status-pending",
    "property": "background",
    "expected": "background: var(--soft);"
  },
  {
    "baseLine": 9749,
    "selector": ".vn-part-modal-close:hover",
    "property": "background",
    "expected": "background: var(--line);"
  },
  {
    "baseLine": 9926,
    "selector": ".vn-part-req-filter-btn:hover",
    "property": "background",
    "expected": "background: var(--soft);"
  },
  {
    "baseLine": 10046,
    "selector": ".vn-part-metric-chip.is-warning",
    "property": "border",
    "expected": "border: 1px solid var(--warn-light);"
  },
  {
    "baseLine": 10064,
    "selector": ".vn-part-planning-notice svg",
    "property": "stroke",
    "expected": "stroke: var(--accent);"
  },
  {
    "baseLine": 10077,
    "selector": ".vn-part-removal-item.is-planned-item",
    "property": "border-left",
    "expected": "border-left: 3px solid var(--warn);"
  },
  {
    "baseLine": 10135,
    "selector": ".vn-part-donor-warning-count",
    "property": "background",
    "expected": "background: var(--warn-light);"
  },
  {
    "baseLine": 10156,
    "selector": ".vn-part-donor-warning-dates",
    "property": "border-left",
    "expected": "border-left: 3px solid var(--accent);"
  },
  {
    "baseLine": 10210,
    "selector": ".vn-part-donor-commitment-row",
    "property": "border",
    "expected": "border: 1px solid var(--warn-light);"
  }
];


let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function declarationCount(name) {
  const pattern = new RegExp(
    "^\\s*" + name + "\\s*:",
    "gmu",
  );

  return (styles.match(pattern) || []).length;
}

function matchingClose(openIndex) {
  let depth = 0;

  for (let index = openIndex; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;

    if (depth === 0) return index;
  }

  return -1;
}

function ruleBodies(selector) {
  const bodies = [];
  let from = 0;

  while (from < styles.length) {
    const index = styles.indexOf(selector, from);

    if (index === -1) break;

    const open = styles.indexOf("{", index + selector.length);

    if (open === -1) break;

    const between = styles
      .slice(index + selector.length, open)
      .trim();

    if (between === "" || between.startsWith(",")) {
      const close = matchingClose(open);

      assert.notEqual(
        close,
        -1,
        `unclosed rule for selector ${selector}`,
      );

      bodies.push(styles.slice(open + 1, close));
    }

    from = index + selector.length;
  }

  return bodies;
}

function normalize(value) {
  return value.replace(/\s+/gu, " ").trim();
}

check("A Foundation declares exactly 20 new tokens once", () => {
  assert.equal(Object.keys(foundationTokens).length, 20);

  for (const [name, value] of Object.entries(foundationTokens)) {
    assert.equal(
      declarationCount(name),
      1,
      `${name} must be declared exactly once`,
    );

    assert.ok(
      styles.includes(`  ${name}: ${value};`),
      `${name} must preserve the approved value`,
    );
  }

  assert.equal(
    declarationCount("--radius-md"),
    0,
    "--radius-md must remain deferred",
  );
});

check("B both legacy :root blocks remain and Foundation does not duplicate into root 2", () => {
  const roots = ruleBodies(":root");

  assert.equal(
    roots.length,
    2,
    "the two legacy :root blocks must remain",
  );

  for (const name of Object.keys(foundationTokens)) {
    assert.ok(
      !roots[1].includes(`${name}:`),
      `${name} must not be duplicated into second :root`,
    );
  }
});

check("C all 57 targeted CSS lines consume the approved token", () => {
  assert.equal(targeted.length, 57);

  for (const item of targeted) {
    const bodies = ruleBodies(item.selector);

    assert.ok(
      bodies.length > 0,
      `selector missing: ${item.selector}`,
    );

    const expected = normalize(item.expected);

    assert.ok(
      bodies.some((body) => normalize(body).includes(expected)),
      `target not migrated: base L${item.baseLine} ${item.selector} ${item.property}`,
    );
  }

  assert.match(
    styles,
    /\.parts-availability-line\.is-unavailable\s*\{[^}]*border-color:\s*#d97706;/u,
    "semantic exclusion for parts unavailable must remain literal",
  );
});

check("D UX-QUICK-001 styles remain intact", () => {
  assert.match(
    styles,
    /\.parts-availability-status\.status-available/u,
  );

  assert.match(
    styles,
    /\.quality-section-progress/u,
  );

  assert.match(
    styles,
    /\.technician-field-action-dock \.technician-complete-action/u,
  );

  assert.match(
    styles,
    /button\.is-pending\[aria-busy="true"\]/u,
  );

  assert.match(
    styles,
    /@keyframes nimr-action-spin/u,
  );
});

check("E CSS brace structure remains balanced", () => {
  const opens = (styles.match(/\{/gu) || []).length;
  const closes = (styles.match(/\}/gu) || []).length;

  assert.equal(opens, closes);
});

console.log(
  `UX-FOUNDATION-001 CONTRACT: ${passed}/5 CHECKS PASSED`,
);
