import React from 'react';
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'fs';
import {resolve} from 'path';
import {renderToStaticMarkup} from 'react-dom/server';
import {WarrantyNetworkWorkspace} from '../src/features/warranty-network/WarrantyNetworkWorkspace';
import {createAgencyWarrantyDraft, type WarrantyActor} from '../src/domain/warranty-network';

const agency:WarrantyActor={userId:'agency-a-user',role:'agent_agence',agencyId:'agency-A',workshopId:'workshop-X'};
const reviewer:WarrantyActor={userId:'central-1',role:'responsable_garantie_support',workshopId:'workshop-X'};
const outsider:WarrantyActor={userId:'agency-b-user',role:'agent_agence',agencyId:'agency-B',workshopId:'workshop-X'};
function item(){return createAgencyWarrantyDraft({
  actor:agency,claimId:'claim-demo',repairOrderId:'or-demo',workshopId:'workshop-X',
  agencyId:'agency-A',vin:'VIN-DEMO',at:'2026-09-30T11:00:00.000Z',
  diagnostic:{complaintVerbatim:'Panne client fictive',findings:'Contrôles effectués',
    suspectedCause:'Défaut présumé',mileageAtDiagnosis:12345},
});}
describe('KHA-76 staged React presentation',()=>{
  it('renders the agency portal on the canonical claim with clear draft and role-specific label',()=>{
    const html=renderToStaticMarkup(<WarrantyNetworkWorkspace item={item()} actor={agency}/>);
    expect(html).toContain('Mes demandes Garantie');
    expect(html).toContain('claim-demo');
    expect(html).toContain('or-demo');
    expect(html).toContain('Panne client fictive');
    expect(html).toContain('Brouillon');
    expect(html).toContain('ni une décision du constructeur');
    expect(html).toMatch(/disabled=""/); // no server callback => action inert
  });
  it('renders the central workspace without enabling a draft-submission button',()=>{
    const html=renderToStaticMarkup(<WarrantyNetworkWorkspace item={item()} actor={reviewer}/>);
    expect(html).toContain('Dossiers Garantie des agences');
    expect(html).toContain('Soumettre à Garantie NIMR');
    expect(html).toMatch(/disabled=""/);
  });
  it('rejects an agency trying to open another agency case even at view level',()=>{
    expect(()=>renderToStaticMarkup(<WarrantyNetworkWorkspace item={item()} actor={outsider}/>)).toThrow(/autre agence/);
  });
  it('reuses the existing MagicPath NIMR Design System v1 rather than a second theme',()=>{
    const html=renderToStaticMarkup(<WarrantyNetworkWorkspace item={item()} actor={agency}/>);
    expect(html).toContain('NIMR DESIGN SYSTEM V1');
    expect(html).toContain('wn-sidebar');
    expect(html).toContain('wn-nav-current');
    expect(html).toContain('wn-topbar');
    const css=readFileSync(resolve(__dirname,'../src/features/warranty-network/warranty-network.css'),'utf-8');
    expect(css).toContain('--wn-sidebar: #111c24');
    expect(css).toContain('--wn-primary: #d7262e');
    expect(css).toContain('--wn-bg: #f5f7f9');
    expect(css).toContain('@media(max-width:760px)');
  });
  it('does not embed a Google Drive binary, secret or live media link into the SSR view',()=>{
    const html=renderToStaticMarkup(<WarrantyNetworkWorkspace item={item()} actor={agency}/>);
    expect(html).not.toContain('drive.google.com');
    expect(html).not.toContain('service_role');
    expect(html).not.toContain('data:image');
  });
});
