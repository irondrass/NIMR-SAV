import {describe,it,expect} from 'vitest';
import {
  createAgencyWarrantyDraft, attachAgencyEvidence, submitAgencyWarranty,
  requestWarrantyInformation, answerWarrantyInformation, postWarrantyMessage,
  reviewAgencyWarranty, requestWarrantyPart, recordWarrantyStockCheck,
  dispatchWarrantyPart, acknowledgeAgencyPart, startAgencyRepair,
  finishAgencyRepair, declareDamagedPartReturn, confirmDamagedPartReceived,
  waiveDamagedPartReturn, archiveAgencyWarrantyCopy, confirmCentralWarrantyCopy,
  networkClosureBlockers, closeWarrantyNetworkCase, assertWarrantyScope,
  type WarrantyNetworkCase, type WarrantyActor, type WarrantyEvidenceKind,
} from '../src/domain/warranty-network';

const at='2026-09-30T10:00:00.000Z';
const agency:WarrantyActor={userId:'agent-A',role:'agent_agence',workshopId:'workshop-1',agencyId:'agency-A'};
const otherAgency:WarrantyActor={userId:'agent-B',role:'agent_agence',workshopId:'workshop-1',agencyId:'agency-B'};
const central:WarrantyActor={userId:'garantie-1',role:'responsable_garantie_support',workshopId:'workshop-1'};
const store:WarrantyActor={userId:'stock-1',role:'responsable_magasin',workshopId:'workshop-1'};
const foreignStore:WarrantyActor={userId:'stock-X',role:'responsable_magasin',workshopId:'workshop-2'};
let sequence=0;
function draft():WarrantyNetworkCase{
  sequence++;
  return createAgencyWarrantyDraft({
    claimId:'claim-'+sequence,repairOrderId:'or-'+sequence,vin:'VIN-FICTIF-'+sequence,
    workshopId:'workshop-1',agencyId:'agency-A',actor:agency,at,
    diagnostic:{complaintVerbatim:'Bruit rapporté par le client',
      findings:'Essai et mesures effectués',suspectedCause:'Composant suspect',
      causalPartReference:'REF-01',dtc:['P0001'],mileageAtDiagnosis:10000},
  });
}
function attach(c:WarrantyNetworkCase,kind:WarrantyEvidenceKind,actor=agency):WarrantyNetworkCase{
  return attachAgencyEvidence(c,actor,c.version,{
    mediaId:'m-'+kind+'-'+c.version,kind,claimId:c.claimId,
    workshopId:c.workshopId,agencyId:c.agencyId,
  },at);
}
function submitted():WarrantyNetworkCase{
  let c=draft();c=attach(c,'before_photo');c=attach(c,'before_video');
  return submitAgencyWarranty(c,agency,c.version,at);
}
function validated():WarrantyNetworkCase{
  const c=submitted();return reviewAgencyWarranty(c,central,c.version,'validate',at);
}
function withParts():WarrantyNetworkCase{
  let c=validated();
  c=requestWarrantyPart(c,central,c.version,{id:'line-1',reference:'REF-01',quantity:1,requiresOldPartReturn:true},at);
  c=recordWarrantyStockCheck(c,store,c.version,'line-1',true,at);
  c=dispatchWarrantyPart(c,store,c.version,'line-1','EXP-001',at);
  return acknowledgeAgencyPart(c,agency,c.version,'line-1',at);
}
function afterRepair():WarrantyNetworkCase{
  let c=withParts();
  c=startAgencyRepair(c,agency,c.version,at);
  c=attach(c,'after_photo');c=attach(c,'after_video');c=attach(c,'qc_report');
  return finishAgencyRepair(c,agency,c.version,true,at);
}
describe('KHA-76 — garantie réseau, rôles et isolation',()=>{
  it('creates an aggregate pointing at an existing claim and OR; never an OEM financial decision',()=>{
    const c=draft();
    expect(c.claimId).toMatch(/^claim-/);
    expect(c.repairOrderId).toMatch(/^or-/);
    expect(c.status).toBe('draft');
    expect(Object.keys(c)).not.toContain('oem_status');
    expect(Object.keys(c)).not.toContain('payment_status');
    expect(c.audit).toHaveLength(1);
  });
  it('requires a server-authorized agency identity and explicit claim/OR/VIN',()=>{
    expect(()=>createAgencyWarrantyDraft({
      claimId:'claim',repairOrderId:'or',vin:'vin',agencyId:'agency-A',workshopId:'workshop-1',at,
      actor:otherAgency,diagnostic:draft().diagnostic,
    })).toThrow(/Agence\/atelier/);
    expect(()=>createAgencyWarrantyDraft({
      claimId:'claim',repairOrderId:'',vin:'vin',agencyId:'agency-A',workshopId:'workshop-1',at,
      actor:agency,diagnostic:draft().diagnostic,
    })).toThrow(/OR canonique/);
  });
  it('prevents cross-agency mutation and cross-workshop central/stock access',()=>{
    const c=draft();
    expect(()=>assertWarrantyScope(c,otherAgency)).toThrow(/autre agence/);
    expect(()=>assertWarrantyScope(c,foreignStore)).toThrow(/autre atelier/);
    expect(()=>attach(c,'before_photo',otherAgency)).toThrow(/autre agence/);
    expect(()=>requestWarrantyInformation(c,otherAgency,c.version,'r','question',at)).toThrow();
  });
  it('blocks missing before photo/video, forged photo linkage, and duplicate media',()=>{
    let c=draft();
    expect(()=>submitAgencyWarranty(c,agency,c.version,at)).toThrow(/Photo et vidéo/);
    expect(()=>attachAgencyEvidence(c,agency,c.version,{
      mediaId:'fake',kind:'before_photo',claimId:'another',workshopId:c.workshopId,agencyId:c.agencyId,
    },at)).toThrow(/lien canonique/);
    c=attach(c,'before_photo');
    expect(()=>attachAgencyEvidence(c,agency,c.version,{...c.evidence[0]},at)).toThrow(/déjà liée/);
    expect(()=>submitAgencyWarranty(c,agency,c.version,at)).toThrow(/Photo et vidéo/);
    c=attach(c,'before_video');
    expect(submitAgencyWarranty(c,agency,c.version,at).status).toBe('submitted');
  });
  it('rejects stale version and invalid/unauthorized messages',()=>{
    const c=submitted();
    expect(()=>requestWarrantyInformation(c,central,c.version-1,'r','more',at)).toThrow(/Conflit/);
    expect(()=>postWarrantyMessage(c,store,c.version,'msg','hello',[],at)).toThrow(/rôle/);
    expect(()=>postWarrantyMessage(c,central,c.version,'msg','hello',['other-case-media'],at)).toThrow(/Pièce jointe/);
    const m=postWarrantyMessage(c,central,c.version,'msg','Informations reçues ?',[],at);
    expect(m.messages).toHaveLength(1);
    expect(c.messages).toHaveLength(0);
    expect(()=>postWarrantyMessage(m,central,m.version,'msg','again',[],at)).toThrow(/doublon/);
  });
  it('preserves all chat questions, prevents premature validation, and resubmits once all are answered',()=>{
    let c=submitted();
    c=requestWarrantyInformation(c,central,c.version,'r1','Photo du connecteur ?',at);
    c=requestWarrantyInformation(c,central,c.version,'r2','Indiquer mesure de tension ?',at);
    expect(c.status).toBe('needs_information');
    expect(()=>reviewAgencyWarranty(c,central,c.version,'validate',at)).toThrow(/non prêt/);
    expect(()=>answerWarrantyInformation(c,central,c.version,'r1','m1','Réponse',[],at)).toThrow(/rôle/);
    c=answerWarrantyInformation(c,agency,c.version,'r1','m1','Photo transmise et commentée',[],at);
    expect(c.status).toBe('needs_information');
    c=answerWarrantyInformation(c,agency,c.version,'r2','m2','Mesure effectuée : 12,6 V',[],at);
    expect(c.status).toBe('submitted');
    expect(c.messages.map(m=>m.infoRequestId)).toEqual(['r1','r2']);
    expect(c.infoRequests.every(r=>!!r.replyMessageId)).toBe(true);
    c=reviewAgencyWarranty(c,central,c.version,'validate',at);
    expect(c.status).toBe('internally_validated');
  });
  it('only central reviewer can validate or reject with a reason',()=>{
    const c=submitted();
    expect(()=>reviewAgencyWarranty(c,agency,c.version,'validate',at)).toThrow(/rôle/);
    expect(()=>reviewAgencyWarranty(c,central,c.version,'reject',at,'')).toThrow(/Motif/);
    const rejected=reviewAgencyWarranty(c,central,c.version,'reject',at,'Panne hors périmètre',);
    expect(rejected.status).toBe('rejected_internal');
    expect(()=>requestWarrantyInformation(rejected,central,rejected.version,'later','more',at)).toThrow(/terminal/);
  });
});
describe('KHA-76 — pièces, retour physique et clôture réseau',()=>{
  it('prevents fictional shipment: stock unavailable and dispatch is store-only',()=>{
    let c=validated();
    c=requestWarrantyPart(c,central,c.version,{id:'line-1',reference:'REF-01',quantity:1,requiresOldPartReturn:true},at);
    expect(()=>dispatchWarrantyPart(c,store,c.version,'line-1','EXP',at)).toThrow(/stock/);
    c=recordWarrantyStockCheck(c,store,c.version,'line-1',false,at);
    expect(c.parts[0].state).toBe('unavailable');
    expect(()=>dispatchWarrantyPart(c,store,c.version,'line-1','EXP',at)).toThrow(/stock/);
    c=recordWarrantyStockCheck(c,store,c.version,'line-1',true,at);
    expect(()=>dispatchWarrantyPart(c,agency,c.version,'line-1','EXP',at)).toThrow(/rôle/);
    c=dispatchWarrantyPart(c,store,c.version,'line-1','EXP-001',at);
    expect(c.status).toBe('parts_in_transit');
    expect(c.parts[0].trackingReference).toBe('EXP-001');
    c=acknowledgeAgencyPart(c,agency,c.version,'line-1',at);
    expect(c.status).toBe('ready_for_repair');
  });
  it('handles two part references independently; one shipped cannot erase the other pending stock check',()=>{
    let c=validated();
    c=requestWarrantyPart(c,central,c.version,{id:'A',reference:'PART-A',quantity:1,requiresOldPartReturn:true},at);
    c=requestWarrantyPart(c,central,c.version,{id:'B',reference:'PART-B',quantity:2,requiresOldPartReturn:false},at);
    c=recordWarrantyStockCheck(c,store,c.version,'A',true,at);
    c=recordWarrantyStockCheck(c,store,c.version,'B',false,at);
    c=dispatchWarrantyPart(c,store,c.version,'A','SHIP-A',at);
    expect(c.status).toBe('parts_in_transit');
    c=acknowledgeAgencyPart(c,agency,c.version,'A',at);
    expect(c.status).toBe('parts_in_transit');
    expect(()=>startAgencyRepair(c,agency,c.version,at)).toThrow(/pièces/);
    c=recordWarrantyStockCheck(c,store,c.version,'B',true,at);
    c=dispatchWarrantyPart(c,store,c.version,'B','SHIP-B',at);
    c=acknowledgeAgencyPart(c,agency,c.version,'B',at);
    expect(c.status).toBe('ready_for_repair');
    expect(c.parts.map(p=>p.state)).toEqual(['received','received']);
  });
  it('rejects repair before all parts received and missing post-repair evidence/QC',()=>{
    let c=withParts();
    expect(()=>finishAgencyRepair(c,agency,c.version,true,at)).toThrow(/aucune réparation/i);
    c=startAgencyRepair(c,agency,c.version,at);
    expect(()=>finishAgencyRepair(c,agency,c.version,true,at)).toThrow(/Photos, vidéo/);
    c=attach(c,'after_photo');c=attach(c,'after_video');c=attach(c,'qc_report');
    expect(()=>finishAgencyRepair(c,agency,c.version,false,at)).toThrow(/contrôle qualité/);
    expect(finishAgencyRepair(c,agency,c.version,true,at).status).toBe('awaiting_returns');
  });
  it('requires central physical receipt of defective parts and submitted+verified copy before closure',()=>{
    let c=afterRepair();
    expect(networkClosureBlockers(c).some(s=>s.includes('Ancienne pièce'))).toBe(true);
    expect(()=>closeWarrantyNetworkCase(c,central,c.version,at)).toThrow(/Copie/);
    c=attach(c,'damaged_part_photo');c=attach(c,'return_shipping_proof');
    c=declareDamagedPartReturn(c,agency,c.version,'line-1','RET-001',at);
    expect(c.parts[0].returnState).toBe('sent');
    expect(()=>confirmDamagedPartReceived(c,agency,c.version,'line-1',at)).toThrow(/rôle/);
    c=attach(c,'warranty_copy');
    c=archiveAgencyWarrantyCopy(c,agency,c.version,at);
    expect(networkClosureBlockers(c)).toContain('Copie Garantie non reçue/validée par NIMR.');
    c=confirmCentralWarrantyCopy(c,central,c.version,at);
    expect(()=>closeWarrantyNetworkCase(c,central,c.version,at)).toThrow(/Ancienne pièce/);
    c=confirmDamagedPartReceived(c,store,c.version,'line-1',at);
    expect(networkClosureBlockers(c)).toEqual([]);
    c=closeWarrantyNetworkCase(c,central,c.version,at);
    expect(c.status).toBe('network_closed');
    expect(()=>postWarrantyMessage(c,agency,c.version,'late','late',[],at)).toThrow(/terminal/);
  });
  it('requires an auditable, explicit central waiver if defective part return is not mandated',()=>{
    let c=afterRepair();c=attach(c,'warranty_copy');
    c=archiveAgencyWarrantyCopy(c,agency,c.version,at);
    c=confirmCentralWarrantyCopy(c,central,c.version,at);
    expect(()=>waiveDamagedPartReturn(c,agency,c.version,'line-1','Non exigée constructeur',at)).toThrow(/rôle/);
    expect(()=>waiveDamagedPartReturn(c,central,c.version,'line-1','ok',at)).toThrow(/insuffisant/);
    c=waiveDamagedPartReturn(c,central,c.version,'line-1','Consigne constructeur documentée : pièce conservée en agence',at);
    expect(c.parts[0].returnState).toBe('waived');
    expect(c.parts[0].returnDecisionReason).toContain('constructeur');
    expect(networkClosureBlockers(c)).toEqual([]);
  });
  it('keeps the agency workflow independent from final OEM adjudication and settlement',()=>{
    let c=afterRepair();c=attach(c,'warranty_copy');
    c=archiveAgencyWarrantyCopy(c,agency,c.version,at);
    c=confirmCentralWarrantyCopy(c,central,c.version,at);
    c=waiveDamagedPartReturn(c,central,c.version,'line-1','Retour non exigé suivant procédure OEM',at);
    const closed=closeWarrantyNetworkCase(c,central,c.version,at);
    expect(closed.status).toBe('network_closed');
    expect((closed as unknown as Record<string,unknown>).oem_status).toBeUndefined();
    expect((closed as unknown as Record<string,unknown>).payment_status).toBeUndefined();
    expect(closed.audit.at(-1)?.action).toBe('agency_network_closed');
  });
});
