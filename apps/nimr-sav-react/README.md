# NIMR SAV React — v24.0.0-alpha.15

Version de rattrapage fonctionnel / retour en phase alpha.

Application React + TypeScript pour NIMR Carrosserie SAV.

> Version de rattrapage — cette étape organise le retour en développement alpha après le refus terrain de la rc.1 (NO-GO). Elle n’est pas destinée à la production, n’est pas une version finale/RC, et ne crée aucun tag ni push automatique.

## Séparation stricte de v23.x

| Élément | v23.x (racine) | v24 React |
|---|---|---|
| Statut | Pilote stable `v23.2.6` | Rattrapage fonctionnel alpha.14 |
| Port | Serveur statique | 5173 (Vite) |
| localStorage | `nimr-sav-*` | `nimr-sav-react-v24-*` |
| Service Worker | `sw.js` actif côté v23 | Aucun service worker React actif |
| Cache | `nimr-sav-v23.2.x-*` | `nimr-sav-react-v24-alpha` réservé |
| Données | `data/vehicles.json` | Doit rester strictement `[]` |

## Commandes de validation locale

```bash
npm ci
npm run lint
npm test
npm run build
npm audit --registry=https://registry.npmjs.org/
```

## Écrans par rôle

- Réception SAV : créer et qualifier les dossiers atelier lors de la prise en charge.
- Planification Atelier : affecter les techniciens, gérer la priorité et organiser les tâches.
- Espace Technicien : suivre les tâches affectées et valider l’avancement atelier.
- Contrôle Qualité : vérifier la conformité technique et gérer les reprises.
- Livraison Client : préparer la remise, ajouter une preuve et confirmer la livraison.
- Directeur SAV : consulter les KPIs et alertes opérationnelles sans mutation métier.
- Console Administration : consulter la gouvernance, les rôles et les invariants.
- Mode Lecture Seule : consulter passivement sans action d’écriture.

## Version

`v24.0.0-alpha.15` — Version de rattrapage fonctionnel / retour en développement alpha (rc.1 historique non modifiée).

- alpha.15 interne uniquement (non destiné à la production et non finale).
- Aucun tag automatique, ni de push automatique.
- Le pilote stable reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement `[]`.
- React v24 reste sans service worker actif (offline/PWA reporté au Lot alpha.18).
- Aucun backend ni Supabase ajouté (lot Cloud/Supabase séparé post-alpha).
- La recette métier alpha.12 est conservée.
- Le gel fonctionnel alpha.13 est conservé.
- `v24.0.0` final reste hors périmètre.

## Roadmap des Lots de Rattrapage Fonctionnel

- **alpha.14** : Planning Atelier Avancé, suggestions de créneaux, collisions, capacité ressources, Gantt.
- **alpha.15** (Version courante) : Multi-sinistres / Claims / Accords Expert & Client.
- **alpha.16** : Import Devis & Calcul Charge Atelier.
- **alpha.17** : Impressions & Exports ZIP/PDF.
- **alpha.18** : Mode Offline & PWA.
- **Cloud/Supabase** : Synchronisation & Sécurité Cloud (séparé en lot post-alpha).

## Readiness alpha.15

alpha.15 confirme :

- version alignée sur `v24.0.0-alpha.15` ;
- couverture fonctionnelle : multi-sinistres, claims et accords expert/client ;
- statut de développement alpha de rattrapage (non RC, non production) ;
- absence d’exposition production et absence de version finale ;
- absence de tag ou de push automatique ;
- rôles et statuts officiels uniquement ;
- flux métier alpha.12 et gel fonctionnel alpha.13 conservés ;
- consultation Direction/Admin/Lecture seule sans mutation ;
- blocage de la planification en cas d'accord expert/client requis manquant ;
- dérogation exceptionnelle par Admin avec motif obligatoire ;
- livraison impossible sans qualité approuvée ;
- dossier livré sans retour arrière.

## Handoff validation terrain finale

La validation terrain doit rejouer une journée SAV fictive :

- réception de plusieurs dossiers ;
- affectation atelier ;
- intervention technicien ;
- attente pièces ;
- rejet qualité ;
- reprise atelier ;
- approbation qualité ;
- livraison client ;
- consultation direction/admin/lecture seule.

Critères bloquants : perte de dossier, mutation par lecture seule, livraison sans qualité approuvée, statut incohérent, rôle non autorisé, donnée client réelle, erreur console critique, échec test/build/audit.

## Prochaine étape possible

Décision humaine GO / NO-GO pour tag rc.1 éventuel, après validations locales, clone frais GitHub, smoke navigateur, tests v23.2.6 et validation terrain manuelle.
