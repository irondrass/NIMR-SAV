import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../src/constants/version';
import {
  parseEstimateText,
  parseEstimateHtml,
  normalizeMoneyValue,
  stripHtmlToText
} from '../src/domain/estimate-parser';

describe('Estimate Parser Domain Tests', () => {
  it('verifies correct app version constant', () => {
    expect(APP_VERSION).toBe('v24.0.0-alpha.19');
  });

  it('normalizes money values with commas and dots', () => {
    expect(normalizeMoneyValue('1 200,50')).toBe(1200.5);
    expect(normalizeMoneyValue('450.000 DT')).toBe(450);
    expect(normalizeMoneyValue('33,000')).toBe(33);
    expect(normalizeMoneyValue('35.00')).toBe(35);
  });

  it('strips HTML to text preserving lines', () => {
    const html = '<div>Line 1</div><p>Line 2</p><table><tr><td>Cell</td></tr></table>';
    const text = stripHtmlToText(html);
    expect(text).toContain('Line 1');
    expect(text).toContain('Line 2');
    expect(text).toContain('Cell');
  });

  it('parses simple text devis format', () => {
    const devisTxt = `
DEVIS ESTIMATIF ATELIER
NÂ° DEVIS: DV-2026-999
CLIENT: DUPONT JEAN
MATRICULE: 123 TU 4567

DESIGNATION QTE PU MONTANT
D/P AILE AVANT 1.50 33.000 49.500
REPLACEMENT PHARE D 1.00 35.000 35.000
PARE-CHOC AV NEUF 1.00 450.000 450.000
PEINTURE APPRET 2.00 33.000 66.000

TOTAL HT: 600.500
TVA 19%: 114.095
TOTAL TTC: 714.595 TND
    `;

    const estimate = parseEstimateText(devisTxt, 'devis_test.txt', 'user-reception');

    expect(estimate.sourceFileName).toBe('devis_test.txt');
    expect(estimate.sourceType).toBe('txt');
    expect(estimate.totals.amountHT).toBe(600.5);
    expect(estimate.totals.amountTTC).toBe(714.595);

    // Verify lines
    expect(estimate.lines).toHaveLength(4);

    // Labor lines
    const laborLines = estimate.lines.filter(l => l.isLabor);
    expect(laborLines).toHaveLength(3);

    // Parts lines
    const partsLines = estimate.lines.filter(l => l.isPart);
    expect(partsLines).toHaveLength(1);
    expect(partsLines[0].label).toBe('PARE-CHOC AV NEUF');
    expect(partsLines[0].totalPrice).toBe(450);

    // Warnings & Confidence
    expect(estimate.warnings).toHaveLength(0);
    expect(estimate.confidenceScore).toBeGreaterThan(0.7);
  });

  it('parses simple HTML devis format', () => {
    const devisHtml = `
      <html>
        <body>
          <h1>DEVIS ESTIMATIF</h1>
          <p>NÂ° DEVIS: DV-HTML-555</p>
          <table>
            <tr><td>REDRESSAGE PORTIERE</td><td>2.00</td><td>33,000</td><td>66,000</td></tr>
            <tr><td>VERTE OPTIQUE AR</td><td>1.00</td><td>150.000</td><td>150.000</td></tr>
          </table>
          <div>TOTAL HT 216,000</div>
          <div>TOTAL TTC 257,040</div>
        </body>
      </html>
    `;

    const estimate = parseEstimateHtml(devisHtml, 'devis.html', 'user-reception');

    expect(estimate.sourceType).toBe('html');
    expect(estimate.totals.amountTTC).toBe(257.04);
    expect(estimate.lines).toHaveLength(2);
    expect(estimate.lines[0].isLabor).toBe(true);
    expect(estimate.lines[1].isPart).toBe(true);
  });
});
