import React, {useState} from 'react';
import {
  assertWarrantyScope, networkClosureBlockers,
  type WarrantyActor, type WarrantyNetworkCase, type WarrantyEvidenceKind,
} from '../../domain/warranty-network';
import './warranty-network.css';

/** Staged UI only: App login/routes remain unchanged until RLS/auth/Media APIs pass STAGING. */
export interface WarrantyNetworkWorkspaceProps {
  item:WarrantyNetworkCase; actor:WarrantyActor;
  onSubmitAgencyRequest?:()=>void; onSendMessage?:(body:string)=>void;
}
type Tab='diagnostic'|'evidence'|'chat'|'parts'|'repair'|'closure';
const TABS:readonly {key:Tab;label:string}[]=[
  {key:'diagnostic',label:'Diagnostic'}, {key:'evidence',label:'Preuves'},
  {key:'chat',label:'Discussion'}, {key:'parts',label:'Pièces'},
  {key:'repair',label:'Après réparation'}, {key:'closure',label:'Retours & dossier'},
];
const STATUSES:Record<WarrantyNetworkCase['status'],string>={
  draft:'Brouillon',submitted:'En revue Garantie',needs_information:'Complément demandé',
  internally_validated:'Validé en interne',parts_pending:'Attente pièces',
  parts_in_transit:'Pièces en transport',ready_for_repair:'Prêt pour réparation',
  repair_in_progress:'Réparation en cours',awaiting_returns:'Retours et documents attendus',
  network_closed:'Volet agence clôturé',rejected_internal:'Refus interne',
};
const MEDIA:Record<WarrantyEvidenceKind,string>={
  before_photo:'Photo diagnostic',before_video:'Vidéo diagnostic',
  diagnostic_report:'Rapport diagnostic',dtc:'Codes défaut',
  after_photo:'Photo après réparation',after_video:'Vidéo après réparation',
  qc_report:'Compte rendu CQ',damaged_part_photo:'Photo pièce remplacée',
  return_shipping_proof:'Justificatif retour',warranty_copy:'Copie dossier Garantie',
};
const PART={requested:'Contrôle stock demandé',available:'Disponible confirmé',
  unavailable:'Indisponible',shipped:'Expédiée',received:'Reçue par agence'};
const RETURN={not_sent:'Ancienne pièce attendue',sent:'Expédiée par agence',
  received:'Réceptionnée NIMR',waived:'Dérogation motivée',not_required:'Non requise'};
export const WarrantyNetworkWorkspace:React.FC<WarrantyNetworkWorkspaceProps>=({
  item,actor,onSubmitAgencyRequest,onSendMessage,
})=>{
  // A presentation guard only. The actual authorization MUST occur on the server.
  assertWarrantyScope(item,actor);
  const [tab,setTab]=useState<Tab>('diagnostic');
  const [message,setMessage]=useState('');
  const agency=actor.role==='agent_agence';
  const central=actor.role==='responsable_garantie_support';
  const pending=item.infoRequests.filter(x=>!x.replyMessageId);
  const blockers=networkClosureBlockers(item);
  const has=(kind:WarrantyEvidenceKind)=>item.evidence.some(e=>e.kind===kind);
  const chatAllowed=(agency||central)&&!['network_closed','rejected_internal'].includes(item.status);

  return <div className="wn-app">
    <aside className="wn-sidebar" aria-label="Repères de navigation NIMR SAV">
      <div className="wn-brand">
        <span className="wn-brand-symbol" aria-hidden="true">N</span>
        <span className="wn-brand-name"><strong>NIMR SAV</strong><small>Opérations après-vente</small></span>
      </div>
      <nav className="wn-sidebar-nav" aria-label="Navigation du Design System (maquette)">
        {['Tableau de bord','Réception','Dossiers','Atelier','Planning','Qualité','Pièces','Garantie'].map(name=>
          <span key={name} className={name==='Garantie'?'wn-nav-item wn-nav-current':'wn-nav-item'}
            aria-current={name==='Garantie'?'page':undefined}>
            <span className="wn-nav-dot" aria-hidden="true"></span>{name}
          </span>)}
      </nav>
      <span className="wn-sidebar-foot">NIMR · Design System v1</span>
    </aside>
    <div className="wn-main">
      <header className="wn-topbar">
        <div className="wn-topbar-name">
          <small>NIMR DESIGN SYSTEM V1</small>
          <strong>Interface métier — Garantie Réseau</strong>
        </div>
        <span className="wn-topbar-role">{agency?'Agent agence':central?'Responsable Garantie':'Magasin'}</span>
      </header>
      <main className="wn-shell">
    <header className="wn-header">
      <div><div className="wn-eyebrow">NIMR SAV · Garantie Réseau</div>
        <h1>{agency?'Mes demandes Garantie':central?'Dossiers Garantie des agences':'Pièces Garantie'}</h1>
        <p>Claim {item.claimId} · OR {item.repairOrderId} · Agence {item.agencyId}</p></div>
      <span className={`wn-pill wn-status-${item.status}`}>{STATUSES[item.status]}</span>
    </header>
    <div className="wn-stats">
      <div><small>Véhicule (VIN)</small><strong>{item.vin}</strong></div>
      <div><small>Questions en attente</small><strong>{pending.length}</strong></div>
      <div><small>Pièces non reçues</small><strong>{item.parts.filter(p=>p.state!=='received').length}</strong></div>
      <div><small>Points de clôture</small><strong>{blockers.length}</strong></div>
    </div>
    <p className="wn-help">Le statut de ce volet agence n'est ni une décision du constructeur ni une preuve de paiement.</p>
    <nav className="wn-tabs" aria-label="Sections du dossier">
      {TABS.map(t=><button key={t.key} type="button" onClick={()=>setTab(t.key)}
        aria-current={tab===t.key?'page':undefined} className={tab===t.key?'wn-active':''}>
        {t.label}{t.key==='chat'&&pending.length>0?' ('+pending.length+')':''}</button>)}
    </nav>
    <div className="wn-panel">
      {tab==='diagnostic'&&<>
        <h2>Diagnostic transmis par l'agence</h2>
        <div className="wn-grid">
          <div><small>Plainte du client (verbatim)</small><p>{item.diagnostic.complaintVerbatim}</p></div>
          <div><small>Kilométrage constaté</small><p>{item.diagnostic.mileageAtDiagnosis.toLocaleString('fr-FR')} km</p></div>
          <div><small>Contrôles réalisés</small><p>{item.diagnostic.findings}</p></div>
          <div><small>Cause présumée</small><p>{item.diagnostic.suspectedCause}</p></div>
          <div><small>Pièce causale</small><p>{item.diagnostic.causalPartReference||'À compléter'}</p></div>
          <div><small>DTC</small><p>{item.diagnostic.dtc?.join(', ')||'Non renseignés'}</p></div>
        </div>
        <button className="wn-primary" type="button" disabled={!agency||item.status!=='draft'||!onSubmitAgencyRequest}
          onClick={()=>onSubmitAgencyRequest?.()}>Soumettre à Garantie NIMR</button>
      </>}
      {tab==='evidence'&&<>
        <h2>Photos, vidéos et documents du dossier</h2>
        <p>Les références proviennent de MEDIA ; aucun fichier ni lien Drive non autorisé n'est exposé ici.</p>
        <ul className="wn-list">{item.evidence.map(e=><li key={e.mediaId}><strong>{MEDIA[e.kind]}</strong>
          <small>{e.mediaId}</small></li>)}</ul>
        {!item.evidence.length&&<p className="wn-empty">Aucune preuve liée.</p>}
      </>}
      {tab==='chat'&&<>
        <h2>Échanges agence ↔ responsable Garantie</h2>
        {!!pending.length&&<div className="wn-required"><strong>Informations demandées</strong>
          <ul>{pending.map(r=><li key={r.id}>{r.prompt}</li>)}</ul></div>}
        <ol className="wn-chat">{item.messages.map(m=><li key={m.id}>
          <div><strong>{m.authorRole==='agent_agence'?'Agent agence':'Garantie NIMR'}</strong><time>{m.at}</time></div>
          <p>{m.body}</p>{!!m.mediaIds.length&&<small>{m.mediaIds.length} pièce(s) jointe(s) liée(s)</small>}
        </li>)}</ol>
        {!item.messages.length&&<p className="wn-empty">Aucun échange sur ce dossier.</p>}
        <form className="wn-compose" onSubmit={e=>{e.preventDefault();
          if(chatAllowed&&onSendMessage&&message.trim())onSendMessage(message.trim());}}>
          <label htmlFor="wn-compose">Nouveau message</label>
          <textarea id="wn-compose" rows={3} value={message} onChange={e=>setMessage(e.target.value)}
            disabled={!chatAllowed||!onSendMessage} placeholder="Écrire au sujet du dossier..."/>
          <button className="wn-primary" type="submit" disabled={!chatAllowed||!onSendMessage||!message.trim()}>Envoyer</button>
          {!onSendMessage&&<small>Messagerie désactivée en attendant le raccordement serveur.</small>}
        </form>
      </>}
      {tab==='parts'&&<>
        <h2>Pièces de réparation</h2>
        <div className="wn-overflow"><table><thead><tr><th>Référence</th><th>Qté</th><th>Envoi</th><th>Retour ancienne pièce</th></tr></thead>
          <tbody>{item.parts.map(p=><tr key={p.id}><td>{p.reference}</td><td>{p.quantity}</td>
            <td>{PART[p.state]}<small>{p.trackingReference||'Bon à confirmer'}</small></td>
            <td>{RETURN[p.returnState]}</td></tr>)}</tbody></table></div>
        {!item.parts.length&&<p className="wn-empty">Aucune demande de pièce.</p>}
        <p>Les disponibilités et mouvements réels doivent être confirmés par le magasin et le stock canonique.</p>
      </>}
      {tab==='repair'&&<>
        <h2>Preuves après réparation</h2><ul className="wn-checks">
          {(['after_photo','after_video','qc_report'] as const).map(k=><li key={k}>
            <span>{has(k)?'✓':'○'}</span>{MEDIA[k]}</li>)}
          <li><span>{item.qualityApproved?'✓':'○'}</span>Essai et contrôle qualité validés</li></ul>
      </>}
      {tab==='closure'&&<>
        <h2>Retours physiques et copies Garantie</h2>
        <ul className="wn-checks">
          <li><span>{item.agencyCopyArchived?'✓':'○'}</span>Copie archivée et transmise par l'agence</li>
          <li><span>{item.centralCopyReceived?'✓':'○'}</span>Copie reçue et vérifiée par NIMR</li>
          {item.parts.filter(p=>p.requiresOldPartReturn).map(p=><li key={p.id}>
            <span>{['received','waived'].includes(p.returnState)?'✓':'○'}</span>
            Ancienne pièce {p.reference} : {RETURN[p.returnState]}</li>)}
        </ul>
        {!!blockers.length&&<div className="wn-required"><strong>Clôture bloquée</strong><ul>
          {blockers.map(b=><li key={b}>{b}</li>)}</ul></div>}
        {!blockers.length&&<p>Les obligations du volet réseau sont remplies. Une clôture serveur habilitée reste nécessaire.</p>}
      </>}
    </div>
      </main>
    </div>
  </div>;
};
