import fs from 'node:fs';
import vm from 'node:vm';
const ctx = {
  console,
  window: {},
  MAX_ESTIMATE_IMPORT_SIZE: 10 * 1024 * 1024,
  ESTIMATE_IMPORT_EXTENSIONS: ['pdf','xlsx','csv'],
  DEFAULT_DURATIONS: { body:6, oilService:0, mechanical:0, electrical:0, prep:4, paint:3, reassembly:4, finish:2, quality:0.25 },
  ESTIMATE_PLANNING_KEYS: ['body','oilService','mechanical','electrical','prep','paint','reassembly','finish'],
  ESTIMATE_ALLOWED_KEYS: ['body','oilService','mechanical','electrical','prep','paint','reassembly','finish','quality'],
  uid: (p='id') => `${p}-test`,
  getDurationLabel: (k) => k,
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../js/utils.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(new URL('../js/estimate-import.js', import.meta.url), 'utf8'), ctx);
const devis = `Désignation Qté Prix unitaire Montant
OPTIQUE DE PHARE DROIT LED 1 1 193,576 1 193,576
AILE AVANT DROIT S50 1 404,267 404,267
PARE-CHOCS AVANT S50 1 847,990 847,990
PARE-BOUE AVANT DROIT 1 289,202 289,202
SUPPORT PARE-CHOCS AVANT DROIT 1 25,895 25,895
AGRAFE CALANDRE 30 1,860 55,800
PRODUIT DE PEINTURE 2 180,000 360,000
CHANG PARE-BOUE AVANT DROIT 1 35,000 35,000
CHANG SUPPORT PARE CHOC AV DR 0,4 35,000 14,000
D/P ET PREPARATION PARE-CHOCS AVANT S50 2,5 35,000 87,500
PEINTURE ET FINITION PARE-CHOCS AVANT S50 4,5 35,000 157,500
CHANG OPTIQUE DE PHARE DROIT LED 1 35,000 35,000
D/P ET PREPARATION AILE AVANT DROIT S50 2 35,000 70,000
PEINTURE ET FINITION AILE AVANT DROIT S50 4 35,000 140,000
Total DT 3 715,730`;
const parsed = ctx.parseEstimateText(devis, {fileName:'DEVIS STE SQUARE INFO.pdf'});
console.log(JSON.stringify({detectedHours: parsed.detectedHours, allocations: parsed.allocations, lines: parsed.laborLines.map(l=>[l.operation,l.hours])}, null, 2));
if (Math.abs(parsed.detectedHours - 15.4) > 0.01) throw new Error(`detectedHours expected 15.4 got ${parsed.detectedHours}`);
const e = parsed.allocations;
const expected = {body:2.25, prep:4.25, paint:4.25, reassembly:4.65};
for (const [k,v] of Object.entries(expected)) if (Math.abs(e[k]-v)>0.01) throw new Error(`${k} expected ${v} got ${e[k]}`);

const replacementOnly = ctx.parseEstimateText(`REMP FEU ARR GH FIX LED 0,5 33,000 16,500
CHANG SUPPORT PARE CHOC AV DR 0,4 35,000 14,000`, {fileName:'REMPLACEMENT.pdf'});
if (replacementOnly.allocations.body !== 0) throw new Error(`replacement body expected 0 got ${replacementOnly.allocations.body}`);
if (Math.abs(replacementOnly.allocations.reassembly - 0.9) > 0.01) throw new Error(`replacement reassembly expected 0.9 got ${replacementOnly.allocations.reassembly}`);

console.log('Estimate regression OK');

const chocAv = ctx.parseEstimateText(`D/P ET PREPARATION PARE CHOC ARR 2,5 33,000 82,500
PEINTURE ET FINITION PARE CHOC ARR 4,5 33,000 148,500
DRESSAGE ET PEINTURE JUPE ARRIERE 8 33,000 264,000
REMP FEU ARR GH FIX LED 0,5 33,000 16,500
REMP FEU ARR GH MOBILE LED 0,5 33,000 16,500
DRESSAGE ET PEINTURE MALLE ARR 8 33,000 264,000
PEINTURE ET FINITION PARE CHOC ARR 4,5 33,000 148,500
REMP FEU ARR GH MOBILE LED 0,5 33,000 16,500 DRESSAGE ET PEINTURE MALLE ARR 8 33,000 264,000
PETIT FOURNITURE 0,5 33,000 16,500`, {fileName:'CHOC AV.pdf'});
const chocExpected = {body:6.583333, prep:7.583333, paint:7.583333, reassembly:2.25};
for (const [k,v] of Object.entries(chocExpected)) if (Math.abs(chocAv.allocations[k]-v)>0.00001) throw new Error(`chocAv ${k} expected ${v} got ${chocAv.allocations[k]}`);
if (Math.abs(chocAv.detectedHours - 24) > 0.00001) throw new Error(`chocAv detectedHours expected 24 got ${chocAv.detectedHours}`);
console.log('Choc AV duplicate regression OK');


const report60091 = ctx.parseEstimateText(`D/P ET PREPARATION PARE CHOC ARR 2,5 33,000 82,500
PEINTURE ET FINITION PARE CHOC ARR 4,5 33,000 148,500
DRESSAGE ET PEINTURE JUPE ARRIERE 8 33,000 264,000
REMP FEU ARR GH FIX LED 0,5 33,000 16,500
REMP FEU ARR GH MOBILE LED 0,5 33,000 16,500
DRESSAGE ET PEINTURE MALLE ARR 8 33,000 264,000
PETIT FOURNITURE 0,5 33,000 16,500
PEINTURE ET FINITION PARE CHOC ARR 4,5 33,000
REMP FEU ARR GH MOBILE LED 0,5 33,000`, {fileName:'Report60091.pdf'});
if (report60091.laborLines.length !== 6) throw new Error(`Report60091 expected 6 MO lines got ${report60091.laborLines.length}`);
if (Math.abs(report60091.detectedHours - 24) > 0.00001) throw new Error(`Report60091 detectedHours expected 24 got ${report60091.detectedHours}`);
for (const [k,v] of Object.entries(chocExpected)) if (Math.abs(report60091.allocations[k]-v)>0.00001) throw new Error(`Report60091 ${k} expected ${v} got ${report60091.allocations[k]}`);
console.log('Report60091 duplicate extraction regression OK');

const suppliesOnly = ctx.parseEstimateText(`PETITE FOURNITURE 0,5 33,000 16,500\nPETIT FOURNITURE 0,5 33,000 16,500`, {fileName:'FOURNITURE.pdf'});
if (suppliesOnly.laborLines.length !== 0) throw new Error(`Petite fourniture must be excluded from MO, got ${suppliesOnly.laborLines.length}`);
if (suppliesOnly.detectedHours !== 0) throw new Error(`Petite fourniture detectedHours expected 0 got ${suppliesOnly.detectedHours}`);
console.log('Petite fourniture exclusion regression OK');

const paintSuppliesOnly = ctx.parseEstimateText(`PRODUIT DE PEINTURE 3 180,000 540,000
PRODUITS DE PEINTURE 2 180,000 360,000
FOURNITURE DE PEINTURE 1 180,000 180,000`, {fileName:'PRODUIT_PEINTURE.pdf'});
if (paintSuppliesOnly.laborLines.length !== 0) throw new Error(`Produit de peinture must be excluded from MO, got ${paintSuppliesOnly.laborLines.length}`);
if (paintSuppliesOnly.detectedHours !== 0) throw new Error(`Produit de peinture detectedHours expected 0 got ${paintSuppliesOnly.detectedHours}`);
console.log('Produit de peinture exclusion regression OK');

const gluedPaintSupply = ctx.parseEstimateText(`PEINTURE 5 180,000 900,000 DRESSAGE ET PEINTURE PORTE AV GH 8 33,000 264,000`, {fileName:'PEINTURE_COLLEE.pdf', claimType:'client'});
if (gluedPaintSupply.laborLines.length !== 1) throw new Error(`Peinture collée expected 1 MO line got ${gluedPaintSupply.laborLines.length}`);
if (/180,000|900,000/.test(gluedPaintSupply.laborLines[0].operation)) throw new Error(`Le produit peinture collé ne doit pas apparaître dans l'opération MO: ${gluedPaintSupply.laborLines[0].operation}`);
if (!/^DRESSAGE ET PEINTURE PORTE AV GH$/i.test(gluedPaintSupply.laborLines[0].operation)) throw new Error(`Operation expected DRESSAGE ET PEINTURE PORTE AV GH got ${gluedPaintSupply.laborLines[0].operation}`);
if (Math.abs(gluedPaintSupply.detectedHours - 8) > 0.00001) throw new Error(`Peinture collée expected 8 h got ${gluedPaintSupply.detectedHours}`);
console.log('Produit peinture collé regression OK');

const serviceClient = ctx.parseEstimateText(`VIDANGE MOTEUR 0,7 33,000 23,100
REPARATION MECANIQUE FREINS 2 33,000 66,000
REPARATION ELECTRIQUE FAISCEAU 1,5 33,000 49,500
HUILE MOTEUR 4 25,000 100,000`, {fileName:'SERVICE_CLIENT.pdf', claimType:'electrical_client'});
if (Math.abs(serviceClient.allocations.oilService - 0.7) > 0.00001) throw new Error(`Vidange expected oilService 0.7 got ${serviceClient.allocations.oilService}`);
if (Math.abs(serviceClient.allocations.mechanical - 2) > 0.00001) throw new Error(`Mécanique expected 2 got ${serviceClient.allocations.mechanical}`);
if (Math.abs(serviceClient.allocations.electrical - 1.5) > 0.00001) throw new Error(`Électrique expected 1.5 got ${serviceClient.allocations.electrical}`);
if (Math.abs(serviceClient.detectedHours - 4.2) > 0.00001) throw new Error(`Service client expected 4.2 got ${serviceClient.detectedHours}`);
console.log('Service client regression OK');

const insuranceElectrical = ctx.parseEstimateText(`REPARATION ELECTRIQUE FAISCEAU 1,5 33,000 49,500
DIAGNOSTIC AIRBAG 0,8 33,000 26,400
BATTERIE HAUTE TENSION CONTROLE 1,2 33,000 39,600`, {fileName:'SINISTRE_ELECTRIQUE.pdf', claimType:'assurance'});
if (Math.abs(insuranceElectrical.allocations.electrical - 2.0) > 0.00001) throw new Error(`Sinistre électrique expected 2.0 h electrical got ${insuranceElectrical.allocations.electrical}`);
if (insuranceElectrical.distributedLines.some((line) => line.phase === 'electrical' && /FAISCEAU/.test(line.operation))) throw new Error('Faisceau ne doit pas être classé en électrique sur un sinistre assurance');
console.log('Sinistre electrical scope regression OK');

const report2 = ctx.parseEstimateText(`AGRAFE PANNEAU DE PORTE 8 1,550 12,400
SERRURE DE PORTE AV G 1 192,537 192,537
rempl serrure av gh 1 35,000 35,000`, {fileName:'Report2.pdf', claimType:'client'});
if (report2.laborLines.length !== 1) throw new Error(`Report2 expected 1 MO line got ${report2.laborLines.length}`);
if (Math.abs(report2.detectedHours - 1) > 0.00001) throw new Error(`Report2 detectedHours expected 1 got ${report2.detectedHours}`);
if (Math.abs(report2.allocations.reassembly - 1) > 0.00001) throw new Error(`Report2 expected reassembly 1 got ${report2.allocations.reassembly}`);
console.log('Report2 REMPL serrure regression OK');

const hourlyRateRule = ctx.parseEstimateText(`SERRURE DE PORTE AV G 1 192,537 192,537
rempl serrure av gh 1 35,000 35,000
D/P ET PREPARATION PARE CHOC ARR 2,5 33,000 82,500
ARTICLE PIECE AVEC MOT REPARATION 1 42,000 42,000`, {fileName:'TARIF_MO_33_35.pdf', claimType:'client'});
if (hourlyRateRule.laborLines.length !== 2) throw new Error(`Tarif MO expected 2 labor lines got ${hourlyRateRule.laborLines.length}`);
if (Math.abs(hourlyRateRule.detectedHours - 3.5) > 0.00001) throw new Error(`Tarif MO expected 3.5 got ${hourlyRateRule.detectedHours}`);
if (hourlyRateRule.laborLines.some((line) => /192,537|42,000/.test(line.text))) throw new Error('Les articles hors tarif 33/35 ne doivent pas devenir MO');
console.log('Tarif horaire 33/35 regression OK');

const report3 = ctx.parseEstimateText(`Désignation Qté Prix unitaire Montant
PARE-BRISE A/CAPTEUR ENCAPSULE 1 1 908,025 1 908,025
TUBE COLLE PARE-BRISE 1 32,850 32,850
KIT MONTAGE PARE-BRISE 1 78,550 78,550
rempl pare brise 6 35,000 210,000
CLT23-0909
STE M.H.I
ROUTE RAOUED GAMART
Fax
Tel 98321415
DV-SRV-CH26001606 OR-SRV-CH2602209
Marque Description modèle Kilométrage Limite commande
DFM T5 EVO 1.5L TURBO 52 000
N° Immat. VIN Prem. Immat. Conseiller de vente
6286TU243 LMXA14AF6RZ352028 15/05/24 INES LENGLIZ`, {fileName:'Report3.pdf', claimType:'client'});
if (report3.info.clientName !== 'STE M.H.I') throw new Error(`Report3 client expected STE M.H.I got ${report3.info.clientName}`);
if (report3.info.phone !== '98321415') throw new Error(`Report3 phone expected 98321415 got ${report3.info.phone}`);
if (report3.info.vehicle !== 'T5 EVO 1.5L TURBO') throw new Error(`Report3 vehicle expected T5 EVO 1.5L TURBO got ${report3.info.vehicle}`);
if (report3.info.plate !== '6286TU243') throw new Error(`Report3 plate expected 6286TU243 got ${report3.info.plate}`);
if (report3.info.mileage !== '52000') throw new Error(`Report3 mileage expected 52000 got ${report3.info.mileage}`);
if (report3.info.vin !== 'LMXA14AF6RZ352028') throw new Error(`Report3 VIN expected LMXA14AF6RZ352028 got ${report3.info.vin}`);
if (report3.info.orNumber !== 'OR-SRV-CH2602209') throw new Error(`Report3 OR expected OR-SRV-CH2602209 got ${report3.info.orNumber}`);
if (Math.abs(report3.detectedHours - 6) > 0.01) throw new Error(`Report3 detected hours expected 6 got ${report3.detectedHours}`);
console.log('Report3 header import regression OK');

const partsImport = ctx.parseEstimateText(`PARE-BRISE A/CAPTEUR ENCAPSULE 1 1 908,025 1 908,025
TUBE COLLE PARE-BRISE 1 32,850 32,850
KIT MONTAGE PARE-BRISE 1 78,550 78,550
rempl pare brise 6 35,000 210,000`, {fileName:'PIECES_DEVIS.pdf', claimType:'client'});
if (partsImport.laborLines.length !== 1) throw new Error(`Pieces import expected 1 MO got ${partsImport.laborLines.length}`);
if (partsImport.partsLines.length !== 3) throw new Error(`Pieces import expected 3 parts got ${partsImport.partsLines.length}`);
if (!partsImport.partsLines.some((part) => /PARE-BRISE A\/CAPTEUR/i.test(part.designation))) throw new Error('Pare-brise part not imported');
console.log('Pièces devis import regression OK');

const report1343 = ctx.parseEstimateText(`D/P ET PREPARATIN PARE CHOC AR SUP + INF 3 35,000 105,000
PEINTURE ET FNITION PARE CHOC AR SUP + INF 6 35,000 210,000
D/P LUNETTE AR 2 35,000 70,000
PASSAGE SUR MARBRE 5 35,000 175,000`, {fileName:'1343.pdf', claimType:'assurance'});
if (report1343.laborLines.length !== 4) throw new Error(`Report1343 expected 4 MO lines got ${report1343.laborLines.length}`);
if (Math.abs(report1343.detectedHours - 16) > 0.00001) throw new Error(`Report1343 detectedHours expected 16 got ${report1343.detectedHours}`);
const report1343Expected = {body:7.5, prep:3, paint:3, reassembly:2.5};
for (const [k,v] of Object.entries(report1343Expected)) if (Math.abs(report1343.allocations[k]-v)>0.00001) throw new Error(`Report1343 ${k} expected ${v} got ${report1343.allocations[k]}`);
console.log('Report1343 split/marbre regression OK');

// Test de détection par prix unitaire NIMR 33/35 TND et anti-faux positifs
const nimrPriceDetectionDevis = `FILTRE à HUILE 1 14,365 14,365
RONDELLE DE VIDANGE 1 1,795 1,795
HUILE MOTEUR MOBIL SUPER 5W30 4 25,370 101,480
FILTRE D'HABITACLE 1 47,658 47,658
FILTRE A AIR 1 46,821 46,821
entretien 1 33,000 33,000
remp filtre a air 0,3 33,000 9,900
remp filtre habitacle 0,3 33,000 9,900
COLLIER DE CHAPEAU 2 16,500 33,000`;

const nimrParsed = ctx.parseEstimateText(nimrPriceDetectionDevis, {fileName:'DEVIS_NIMR.pdf', claimType:'vidange'});
if (nimrParsed.laborLines.length !== 3) {
  console.log(JSON.stringify(nimrParsed.laborLines, null, 2));
  throw new Error(`NIMR laborLines count expected 3 got ${nimrParsed.laborLines.length}`);
}
if (Math.abs(nimrParsed.detectedHours - 1.6) > 0.01) {
  throw new Error(`NIMR detectedHours expected 1.6 got ${nimrParsed.detectedHours}`);
}
if (nimrParsed.partsLines.length !== 6) {
  console.log(JSON.stringify(nimrParsed.partsLines, null, 2));
  throw new Error(`NIMR partsLines count expected 6 got ${nimrParsed.partsLines.length}`);
}
// S'assurer que le Collier de chapeau avec PU 16.5 et montant 33 reste une pièce et n'est pas classé en MO
const hasCollierAsLabor = nimrParsed.laborLines.some(l => /COLLIER/i.test(l.operation));
if (hasCollierAsLabor) {
  throw new Error('COLLIER DE CHAPEAU avec PU 16.5 et montant total 33 classé par erreur en main-d’œuvre !');
}

console.log('NIMR Labor Unit Price detection and anti-false positive regression OK');
