/**
 * KHA-76 — isolated, in-memory business contract for agency <-> NIMR warranty.
 *
 * NOT an authentication, inventory, media-upload, or persistence boundary.
 * A future server adapter MUST resolve actor/agency/workshop from the authenticated
 * session, load the canonical repair_claims + repair_orders + photos links, enforce
 * RLS/GRANTs, verify actual stock, and stamp timestamps/audit atomically.
 * Never persist this aggregate as a second claim or infer OEM approval/payment.
 */
export type WarrantyNetworkRole =
  | 'agent_agence'
  | 'responsable_garantie_support'
  | 'responsable_magasin';

export type WarrantyNetworkStatus =
  | 'draft'
  | 'submitted'
  | 'needs_information'
  | 'internally_validated'
  | 'parts_pending'
  | 'parts_in_transit'
  | 'ready_for_repair'
  | 'repair_in_progress'
  | 'awaiting_returns'
  | 'network_closed'
  | 'rejected_internal';

export type WarrantyEvidenceKind =
  | 'before_photo' | 'before_video' | 'diagnostic_report' | 'dtc'
  | 'after_photo' | 'after_video' | 'qc_report'
  | 'damaged_part_photo' | 'return_shipping_proof' | 'warranty_copy';

export interface WarrantyActor {
  userId: string;
  workshopId: string;
  role: WarrantyNetworkRole;
  /** Server-authorized membership, NOT an agencyId supplied in the request body. */
  agencyId?: string;
}
export interface WarrantyEvidence {
  mediaId: string; // existing public.photos.id, not a binary, URL or Drive secret
  kind: WarrantyEvidenceKind;
  claimId: string;
  workshopId: string;
  agencyId: string;
}
export interface AgencyDiagnostic {
  complaintVerbatim: string;
  findings: string;
  suspectedCause: string;
  causalPartReference?: string;
  dtc?: string[];
  mileageAtDiagnosis: number;
}
export interface WarrantyMessage {
  id: string;
  authorId: string;
  authorRole: 'agent_agence' | 'responsable_garantie_support';
  body: string;
  mediaIds: string[];
  infoRequestId?: string;
  at: string;
}
export interface InformationRequest {
  id: string;
  prompt: string;
  createdBy: string;
  at: string;
  replyMessageId?: string;
}
export interface WarrantyPartDispatch {
  id: string;
  reference: string;
  quantity: number;
  requiresOldPartReturn: boolean;
  state: 'requested' | 'available' | 'unavailable' | 'shipped' | 'received';
  trackingReference?: string;
  /** Only the central receiver/stock can attest physical receipt. */
  returnState: 'not_sent' | 'sent' | 'received' | 'waived' | 'not_required';
  returnTrackingReference?: string;
  returnDecisionReason?: string;
}
export interface WarrantyAuditEvent {
  action: string;
  actorId: string;
  at: string;
  version: number;
  note?: string;
}
export interface WarrantyNetworkCase {
  claimId: string; // FK to canonical repair_claims, NEVER a new claim ID
  repairOrderId: string;
  workshopId: string;
  agencyId: string;
  vin: string;
  diagnostic: AgencyDiagnostic;
  status: WarrantyNetworkStatus;
  version: number;
  evidence: WarrantyEvidence[];
  messages: WarrantyMessage[];
  infoRequests: InformationRequest[];
  parts: WarrantyPartDispatch[];
  qualityApproved: boolean;
  agencyCopyArchived: boolean;
  centralCopyReceived: boolean;
  audit: WarrantyAuditEvent[];
}

function required(value: string, name: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${name} obligatoire.`);
  return clean;
}
function requireRole(actor: WarrantyActor, ...roles: WarrantyNetworkRole[]): void {
  if (!roles.includes(actor.role)) throw new Error('Action interdite pour ce rôle Garantie.');
  required(actor.userId, 'Identité authentifiée');
}
export function assertWarrantyScope(item: WarrantyNetworkCase, actor: WarrantyActor): void {
  if (!actor.workshopId || actor.workshopId !== item.workshopId) {
    throw new Error('Accès refusé : autre atelier.');
  }
  if (actor.role === 'agent_agence' && (!actor.agencyId || actor.agencyId !== item.agencyId)) {
    throw new Error('Accès refusé : autre agence.');
  }
  // Central roles also require a verified server-side assignment/workshop membership.
}
function authorize(item: WarrantyNetworkCase, actor: WarrantyActor, ...roles: WarrantyNetworkRole[]): void {
  requireRole(actor, ...roles);
  assertWarrantyScope(item, actor);
  if (item.status === 'network_closed' || item.status === 'rejected_internal') {
    throw new Error('Dossier réseau terminal : modification interdite.');
  }
}
function version(item: WarrantyNetworkCase, expected: number): void {
  if (item.version !== expected) throw new Error('Conflit de version : recharger le dossier.');
}
function evolve(item: WarrantyNetworkCase, actor: WarrantyActor, at: string, action: string,
  changes: Partial<WarrantyNetworkCase>, note?: string): WarrantyNetworkCase {
  const next = item.version + 1;
  return { ...item, ...changes, version: next,
    audit: [...item.audit, { action, actorId: actor.userId, at: required(at, 'Horodatage serveur'), version: next, note }] };
}
function evidenceFor(item: WarrantyNetworkCase, kind: WarrantyEvidenceKind): WarrantyEvidence[] {
  return item.evidence.filter(e => e.kind === kind);
}
function hasEvidence(item: WarrantyNetworkCase, kind: WarrantyEvidenceKind): boolean {
  return evidenceFor(item, kind).length > 0;
}
function nonemptyDiagnostic(d: AgencyDiagnostic): void {
  required(d.complaintVerbatim, 'Plainte client verbatim');
  required(d.findings, 'Diagnostic');
  required(d.suspectedCause, 'Cause présumée');
  if (!Number.isFinite(d.mileageAtDiagnosis) || d.mileageAtDiagnosis < 0) {
    throw new Error('Kilométrage diagnostic invalide.');
  }
}
function openRequests(item: WarrantyNetworkCase): InformationRequest[] {
  return item.infoRequests.filter(x => !x.replyMessageId);
}

/** Caller must have separately verified existing claim, OR, VIN and their workshop FK. */
export function createAgencyWarrantyDraft(params: {
  claimId: string; repairOrderId: string; workshopId: string; agencyId: string; vin: string;
  diagnostic: AgencyDiagnostic; actor: WarrantyActor; at: string;
}): WarrantyNetworkCase {
  requireRole(params.actor, 'agent_agence');
  const { actor } = params;
  if (!actor.agencyId || actor.agencyId !== params.agencyId || actor.workshopId !== params.workshopId) {
    throw new Error('Agence/atelier non autorisé.');
  }
  const item: WarrantyNetworkCase = {
    claimId: required(params.claimId, 'Claim existant'),
    repairOrderId: required(params.repairOrderId, 'OR canonique'),
    workshopId: required(params.workshopId, 'Atelier'),
    agencyId: required(params.agencyId, 'Agence'),
    vin: required(params.vin, 'VIN'),
    diagnostic: { ...params.diagnostic, dtc: [...(params.diagnostic.dtc || [])] },
    status: 'draft', version: 0, evidence: [], messages: [], infoRequests: [], parts: [],
    qualityApproved: false, agencyCopyArchived: false, centralCopyReceived: false, audit: [],
  };
  nonemptyDiagnostic(item.diagnostic);
  return evolve(item, actor, params.at, 'agency_draft_created', {});
}
/** media record association and consent must also be checked against photos in server DB. */
export function attachAgencyEvidence(item: WarrantyNetworkCase, actor: WarrantyActor,
  expected: number, evidence: WarrantyEvidence, at: string): WarrantyNetworkCase {
  authorize(item, actor, 'agent_agence');
  version(item, expected);
  if (!['draft','needs_information','submitted','repair_in_progress','awaiting_returns'].includes(item.status)) {
    throw new Error('Ajout de preuve interdit à cette étape.');
  }
  if (evidence.claimId !== item.claimId || evidence.workshopId !== item.workshopId ||
      evidence.agencyId !== item.agencyId) throw new Error('Preuve sans lien canonique au dossier/agence.');
  required(evidence.mediaId, 'Référence média');
  if (item.evidence.some(e => e.mediaId === evidence.mediaId)) throw new Error('Preuve déjà liée.');
  const postRepair = ['after_photo','after_video','qc_report','damaged_part_photo','return_shipping_proof','warranty_copy'].includes(evidence.kind);
  if (postRepair && !['repair_in_progress','awaiting_returns'].includes(item.status)) {
    throw new Error('Preuve post-réparation non autorisée avant intervention.');
  }
  if (!postRepair && item.status === 'awaiting_returns') throw new Error('Diagnostic gelé après réparation.');
  return evolve(item, actor, at, 'agency_evidence_attached', {evidence:[...item.evidence, {...evidence}]}, evidence.kind);
}
export function submitAgencyWarranty(item: WarrantyNetworkCase, actor: WarrantyActor, expected: number, at: string): WarrantyNetworkCase {
  authorize(item, actor, 'agent_agence'); version(item, expected);
  if (item.status !== 'draft' && item.status !== 'submitted') throw new Error('Soumission invalide à cette étape.');
  nonemptyDiagnostic(item.diagnostic);
  if (!hasEvidence(item, 'before_photo') || !hasEvidence(item, 'before_video')) {
    throw new Error('Photo et vidéo initiales du diagnostic obligatoires.');
  }
  if (openRequests(item).length) throw new Error('Compléments encore ouverts.');
  return evolve(item, actor, at, 'agency_submitted', {status:'submitted'});
}
export function postWarrantyMessage(item: WarrantyNetworkCase, actor: WarrantyActor,
  expected: number, id: string, body: string, mediaIds: string[], at: string): WarrantyNetworkCase {
  authorize(item, actor, 'agent_agence','responsable_garantie_support'); version(item, expected);
  const text = required(body, 'Message');
  required(id, 'Identifiant message');
  if (item.messages.some(m => m.id === id)) throw new Error('Message en doublon.');
  if (mediaIds.some(mid => !item.evidence.some(e => e.mediaId === mid))) {
    throw new Error('Pièce jointe non liée au dossier.');
  }
  const messages = [...item.messages, { id, authorId:actor.userId,
    authorRole: actor.role as WarrantyMessage['authorRole'], body:text, mediaIds:[...mediaIds],
    at:required(at,'Horodatage serveur') }];
  return evolve(item, actor, at, 'warranty_message_added', { messages });
}
export function requestWarrantyInformation(item: WarrantyNetworkCase, actor: WarrantyActor,
  expected: number, requestId: string, prompt: string, at: string): WarrantyNetworkCase {
  authorize(item, actor, 'responsable_garantie_support'); version(item, expected);
  if (!['submitted','needs_information'].includes(item.status)) throw new Error('Demande de complément hors revue.');
  required(requestId,'Identifiant demande');
  if (item.infoRequests.some(r=>r.id===requestId)) throw new Error('Demande de complément en doublon.');
  const req: InformationRequest = {id:requestId,prompt:required(prompt,'Précision demandée'),createdBy:actor.userId,at:required(at,'Horodatage serveur')};
  return evolve(item,actor,at,'information_requested',{status:'needs_information',infoRequests:[...item.infoRequests,req]},requestId);
}
export function answerWarrantyInformation(item: WarrantyNetworkCase, actor: WarrantyActor,
  expected: number, requestId: string, messageId: string, answer: string, mediaIds: string[], at: string): WarrantyNetworkCase {
  authorize(item,actor,'agent_agence'); version(item,expected);
  if (item.status!=='needs_information') throw new Error('Aucun complément attendu.');
  const req=item.infoRequests.find(r=>r.id===requestId&&!r.replyMessageId);
  if (!req) throw new Error('Demande déjà traitée ou inconnue.');
  const posted=postWarrantyMessage(item,actor,expected,messageId,answer,mediaIds,at);
  const messages=posted.messages.map(m=>m.id===messageId?{...m,infoRequestId:requestId}:m);
  const requests=posted.infoRequests.map(r=>r.id===requestId?{...r,replyMessageId:messageId}:r);
  const status=requests.every(r=>r.replyMessageId)?'submitted':'needs_information';
  return {...posted,status,messages,infoRequests:requests,
    audit:posted.audit.map(e=>e.version===posted.version?{...e,action:'information_answered',note:requestId}:e)};
}
/** Internal reviewer acceptance only: does not change repair_claims.status, oem_status or payment_status. */
export function reviewAgencyWarranty(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  decision:'validate'|'reject',at:string,reason?:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_garantie_support');version(item,expected);
  if(item.status!=='submitted'||openRequests(item).length)throw new Error('Dossier non prêt pour revue Garantie.');
  if(decision==='reject')required(reason||'','Motif du rejet');
  return evolve(item,actor,at,'agency_internal_review',
    {status:decision==='validate'?'internally_validated':'rejected_internal'},reason);
}
export function requestWarrantyPart(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  part:{id:string;reference:string;quantity:number;requiresOldPartReturn:boolean},at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_garantie_support');version(item,expected);
  if(!['internally_validated','parts_pending'].includes(item.status))throw new Error('Demande pièces hors validation.');
  if(!Number.isInteger(part.quantity)||part.quantity<1)throw new Error('Quantité pièce invalide.');
  required(part.id,'ID ligne');required(part.reference,'Référence pièce');
  if(item.parts.some(p=>p.id===part.id))throw new Error('Ligne pièce en doublon.');
  const line:WarrantyPartDispatch={...part,state:'requested',returnState:part.requiresOldPartReturn?'not_sent':'not_required'};
  return evolve(item,actor,at,'warranty_part_requested',{status:'parts_pending',parts:[...item.parts,line]},part.reference);
}
/** Stock verification is an assertion by store role; actual quantity/reservation must be checked atomically against NAVISION/stock server-side. */
export function recordWarrantyStockCheck(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,available:boolean,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_magasin');version(item,expected);
  if(!['parts_pending','parts_in_transit'].includes(item.status))throw new Error('Contrôle stock hors étape.');
  const part=item.parts.find(p=>p.id===partId);
  if(!part||!['requested','unavailable'].includes(part.state))throw new Error('Ligne stock non contrôlable.');
  return evolve(item,actor,at,'stock_checked',
    {parts:item.parts.map(p=>p.id===partId?{...p,state:available?'available':'unavailable'}:p)},partId);
}
export function dispatchWarrantyPart(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,trackingReference:string,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_magasin');version(item,expected);
  const part=item.parts.find(p=>p.id===partId);
  if(!part||part.state!=='available')throw new Error('Expédition impossible : stock non confirmé.');
  const reference=required(trackingReference,'Bon d\'expédition / transport');
  return evolve(item,actor,at,'warranty_part_dispatched',
    {status:'parts_in_transit',parts:item.parts.map(p=>p.id===partId?{...p,state:'shipped',trackingReference:reference}:p)},partId);
}
export function acknowledgeAgencyPart(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,at:string):WarrantyNetworkCase {
  authorize(item,actor,'agent_agence');version(item,expected);
  const part=item.parts.find(p=>p.id===partId);
  if(!part||part.state!=='shipped')throw new Error('Pièce non expédiée.');
  const parts=item.parts.map(p=>p.id===partId?{...p,state:'received' as const}:p);
  const ready=parts.every(p=>p.state==='received');
  return evolve(item,actor,at,'agency_part_received',{status:ready?'ready_for_repair':item.status,parts},partId);
}
export function startAgencyRepair(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,at:string):WarrantyNetworkCase {
  authorize(item,actor,'agent_agence');version(item,expected);
  if(!['internally_validated','ready_for_repair'].includes(item.status) ||
      item.parts.some(p=>p.state!=='received'))throw new Error('Réparation non autorisée : validation ou pièces manquantes.');
  return evolve(item,actor,at,'agency_repair_started',{status:'repair_in_progress'});
}
export function finishAgencyRepair(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  qualityApproved:boolean,at:string):WarrantyNetworkCase {
  authorize(item,actor,'agent_agence');version(item,expected);
  if(item.status!=='repair_in_progress')throw new Error('Aucune réparation en cours.');
  if(!qualityApproved || !hasEvidence(item,'after_photo') || !hasEvidence(item,'after_video') ||
     !hasEvidence(item,'qc_report'))throw new Error('Photos, vidéo et contrôle qualité après réparation requis.');
  return evolve(item,actor,at,'agency_repair_finished',{status:'awaiting_returns',qualityApproved:true});
}
export function declareDamagedPartReturn(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,trackingReference:string,at:string):WarrantyNetworkCase {
  authorize(item,actor,'agent_agence');version(item,expected);
  if(item.status!=='awaiting_returns')throw new Error('Retour après réparation uniquement.');
  const part=item.parts.find(p=>p.id===partId);
  if(!part||part.returnState!=='not_sent')throw new Error('Retour non requis ou déjà déclaré.');
  if(!hasEvidence(item,'damaged_part_photo')||!hasEvidence(item,'return_shipping_proof'))throw new Error('Photo ancienne pièce et preuve d\'expédition requises.');
  return evolve(item,actor,at,'damaged_part_sent',
    {parts:item.parts.map(p=>p.id===partId?{...p,returnState:'sent',returnTrackingReference:required(trackingReference,'Tracking retour')}:p)},partId);
}
export function confirmDamagedPartReceived(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_magasin','responsable_garantie_support');version(item,expected);
  if(item.status!=='awaiting_returns')throw new Error('Réception retour hors étape.');
  const part=item.parts.find(p=>p.id===partId);
  if(!part||part.returnState!=='sent')throw new Error('Retour non expédié ou déjà traité.');
  return evolve(item,actor,at,'damaged_part_physically_received',
    {parts:item.parts.map(p=>p.id===partId?{...p,returnState:'received'}:p)},partId);
}
export function waiveDamagedPartReturn(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,
  partId:string,reason:string,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_garantie_support');version(item,expected);
  if(item.status!=='awaiting_returns')throw new Error('Dérogation hors étape.');
  const part=item.parts.find(p=>p.id===partId);
  if(!part||!part.requiresOldPartReturn||!['not_sent','sent'].includes(part.returnState))throw new Error('Dérogation retour non applicable.');
  if(required(reason,'Motif dérogation').length<8)throw new Error('Motif dérogation insuffisant.');
  return evolve(item,actor,at,'damaged_part_return_waived',
    {parts:item.parts.map(p=>p.id===partId?{...p,returnState:'waived',returnDecisionReason:reason.trim()}:p)},partId);
}
export function archiveAgencyWarrantyCopy(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,at:string):WarrantyNetworkCase {
  authorize(item,actor,'agent_agence');version(item,expected);
  if(item.status!=='awaiting_returns'||!hasEvidence(item,'warranty_copy'))throw new Error('Copie du dossier Garantie non transmise.');
  return evolve(item,actor,at,'agency_warranty_copy_archived',{agencyCopyArchived:true});
}
export function confirmCentralWarrantyCopy(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_garantie_support');version(item,expected);
  if(item.status!=='awaiting_returns'||!item.agencyCopyArchived)throw new Error('Copie agence non archivée/transmise.');
  return evolve(item,actor,at,'central_warranty_copy_verified',{centralCopyReceived:true});
}
export function networkClosureBlockers(item:WarrantyNetworkCase):string[] {
  const reasons:string[]=[];
  if(item.status!=='awaiting_returns') reasons.push('Réparation non terminée ou dossier non prêt.');
  if(!item.qualityApproved)reasons.push('CQ non validé.');
  for(const kind of ['after_photo','after_video','qc_report','warranty_copy'] as const){
    if(!hasEvidence(item,kind))reasons.push(`Preuve obligatoire manquante : ${kind}.`);
  }
  if(!item.agencyCopyArchived)reasons.push('Copie Garantie non archivée par agence.');
  if(!item.centralCopyReceived)reasons.push('Copie Garantie non reçue/validée par NIMR.');
  for(const part of item.parts){
    if(part.state!=='received')reasons.push(`Pièce ${part.reference} non reçue par agence.`);
    if(!['received','waived','not_required'].includes(part.returnState)){
      reasons.push(`Ancienne pièce ${part.reference} non réceptionnée ni dérogée.`);
    }
  }
  return reasons;
}
/** Closes only the agency logistics/repair loop, NOT the OEM adjudication or financial claim. */
export function closeWarrantyNetworkCase(item:WarrantyNetworkCase,actor:WarrantyActor,expected:number,at:string):WarrantyNetworkCase {
  authorize(item,actor,'responsable_garantie_support');version(item,expected);
  const blockers=networkClosureBlockers(item);
  if(blockers.length)throw new Error(blockers.join(' | '));
  return evolve(item,actor,at,'agency_network_closed',{status:'network_closed'});
}
