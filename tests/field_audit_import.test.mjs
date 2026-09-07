import test from 'node:test';
import assert from 'node:assert/strict';
import { createNimrVmContext } from './helpers/nimr_vm_context.mjs';
const runtime = createNimrVmContext();
function parse(text) {
  runtime.context.fieldText = text;
  return runtime.run("parseEstimateText(fieldText, {sourceType:'pdf',claimType:'client'})");
}
// Anonymized text structures from the three field documents. No client record
// or original customer PDF is included in the public repository.
test('RICH6: all eight operations survive, including reinforcement labor', () => {
  const parsed = parse(`D/P ET PREPARATION PARE-CHOCS AR A/RENFORT 2,5 35,000 87,500
DRESSAGE ET PEINTURE AILE ARD 12 35,000 420,000
CHANG FEU ARR D COMPLET 0,5 35,000 17,500
CHANG FEU ARR G COMPLET 0,5 35,000 17,500
CHANG ENSEMBLE CAPTEUR RADAR DE RECUL +SUPPORT 1 35,000 35,000
CHANG FAISCEAU CHASSIS AVEC RADAR DE RECULE 2 35,000 70,000
DRESSAGE ET PEINTURE AILE AR GH 10 35,000 350,000
DRESSAGE ET PEINTURE PORTE BENNE 8 35,000 280,000
PRODUIT DE PEINTURE 3 180,000 540,000`);
  assert.equal(parsed.laborLines.length, 8);
  assert.equal(parsed.detectedHours, 36.5);
  assert.match(parsed.laborLines[0].operation, /RENFORT/);
  assert.ok(Math.abs(parsed.distributedLines.reduce((sum,l)=>sum+l.laborHours,0)-36.5)<0.00001);
});
test('T5: coded supplies expressed in HEURE do not become technician work', () => {
  const parsed = parse(`Edition Fin Des Travaux
MO-TOL D/P ET PREPARATION PORTE AV GH 3 HEUR 35,000 0,00 105,000
MO-TOL PEINTURE ET FINITION PORTE AV GH 6 HEUR 35,000 0,00 210,000
MO-TOL D/P ET PREPARATION AILE AV GH 2 HEUR 35,000 0,00 70,000
MO-TOL PEINTURE ET FINITION AILE AV GH 4 HEUR 35,000 0,00 140,000
MO-TOL CHANG DEUX CHARNIERES PORTE AV GH 1 HEUR 35,000 0,00 35,000
MO-TOL PEINTURE ET FINITION CHARNIERE PORTE AV GH 1,5 HEUR 35,000 0,00 52,500
MO-TOL CHANG ARRET DE PORTE AV 0,5 HEUR 35,000 0,00 17,500
MO-TOL PEINTURE ET FINITION CACHE RETRO GH 1 HEUR 35,000 0,00 35,000
MO-002067 PRODUIT DE PEINTURE 2,3 HEUR 180,000 0,00 414,000
MO-TOL PETIT FOURNITURE 0,5 HEUR 35,000 0,00 17,500`);
  assert.equal(parsed.detectedHours,19);
  assert.equal(parsed.laborLines.length,8);
  assert.equal(parsed.documentType,'work_completed');
  assert.equal(parsed.partsLines.length,2);
});
test('BOX: joined supply and replacement produce exactly two MO lines, 15 hours', () => {
  const parsed = parse(`PRODUIT DE PEINTURE 1 180,000 180,000 CHANG BAGUETTE DE PORTE AV DR 1 35,000 35,000
DRESSAGE ET PEINTURE BAS DE CAISSE LAT DR 14 35,000 490,000`);
  assert.equal(parsed.detectedHours,15);
  assert.equal(parsed.laborLines.length,2);
  assert.ok(parsed.laborLines.every(l=>!l.operation.includes('180,000')));
});
test('only priced articles survive, including references, thousands and discounts', () => {
  const parsed = parse(`PARE-CHOCS AR A/RENFORT 1 1 296,072 1 296,072
ART23/1832 PORTE AV GH 1 PCS 2 656,548 0,00 2 656,548
BAGUETTE 2 100,000 10,00 180,000
DONGFENG BOX EV 430 2 950
9999TU999 LDP43A963SS112332 09/03/26
Tunis le: 07/07/2026
Après 30 jours si le client ne se manifeste pas pour la réparation de son véhicule le parking sera facturé à hauteur de 15 Dinars`);
  assert.equal(parsed.partsLines.length,3);
  assert.deepEqual(Array.from(parsed.partsLines,p=>p.quantity),[1,1,2]);
  assert.equal(parsed.partsLines[0].unitPrice,1296.072);
  assert.equal(parsed.partsLines[1].unitPrice,2656.548);
});
test('header identity keeps model variant, full OR, client and non-TU plate', () => {
  const parsed=parse(`CLT26-0001
CLIENT EXEMPLE
Tel 12345678
Devis atelier
N° Devis : DV-TEST-0001 N° OR: OR-TEST-0001
DFM PICKUP DFM RICH6 4X4 EN 40 000
SKD
N° Immat. VIN Prem. Immat.
02-123456 LJNTGUC34PN303098 29/08/23`);
  assert.equal(parsed.info.estimateNumber,'DV-TEST-0001');
  assert.equal(parsed.info.orNumber,'OR-TEST-0001');
  assert.equal(parsed.info.plate,'02-123456');
  assert.match(parsed.info.vehicle,/EN SKD$/);
  assert.equal(parsed.info.mileage,'40000');
  assert.equal(parse('DONGFENG BOX EV 430 2 950').info.vehicle,'DONGFENG BOX EV 430');
  const t5=parse(`N° client facturé CLT26-0001\nMF/CNI 0000000TEST\nCLIENT EXEMPLE\nN° OR OR-TEST-0002\nDFM T5 EVO 1.5L TURBO FULL OPTION 42000 PERSONNE.EXEMPLE`);
  assert.equal(t5.info.clientName,'CLIENT EXEMPLE');
  assert.equal(t5.info.clientNumber,'CLT26-0001');
  assert.equal(t5.info.vehicle,'DFM T5 EVO 1.5L TURBO FULL OPTION');
  assert.equal(t5.info.mileage,'42000');
});
test('PDF layout rejoins wrapped designation, never the wrapped unit or header', () => {
  runtime.context.fieldItems=[
    {text:'MO-TOL',x:10,y:500},{text:'PEINTURE ET FINITION CHARNIERE PORTE AV',x:100,y:500},
    {text:'1,5',x:360,y:500},{text:'HEUR',x:390,y:500},{text:'35,000',x:430,y:500},{text:'0,00',x:470,y:500},{text:'52,500',x:520,y:500},
    {text:'GH',x:100,y:489},{text:'E',x:390,y:489},
    {text:'Total HT',x:10,y:470},{text:'52,500',x:520,y:470}
  ];
  const text=runtime.run('buildPdfTextLines(fieldItems)');
  const parsed=parse(text);
  assert.equal(parsed.laborLines.length,1);
  assert.equal(parsed.laborLines[0].operation,'PEINTURE ET FINITION CHARNIERE PORTE AV GH');
  assert.equal(parsed.detectedHours,1.5);
  assert.match(text,/Total HT/);
});
