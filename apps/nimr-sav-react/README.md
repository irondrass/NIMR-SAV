# NIMR SAV React — v24.0.0-rc.1

Release Candidate interne / validation terrain finale.

Application React + TypeScript pour NIMR Carrosserie SAV.

> RC interne — cette étape organise la validation terrain finale. Elle n’est pas destinée à la production, n’est pas la version finale et ne crée aucun tag automatiquement.

## Séparation stricte de v23.x

| Élément | v23.x (racine) | v24 React |
|---|---|---|
| Statut | Pilote stable `v23.2.6` | RC interne de validation |
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

`v24.0.0-rc.1` — Release Candidate interne / validation terrain finale.

- rc.1 interne uniquement.
- Non destinée à la production.
- Non finale.
- Aucun tag automatique.
- Aucun push automatique.
- Le pilote stable reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement `[]`.
- React v24 reste sans service worker actif.
- Aucun backend ajouté.
- Aucun Supabase ajouté.
- La recette métier alpha.12 est conservée.
- Le gel fonctionnel alpha.13 est conservé.
- `v24.0.0` final reste hors périmètre.

## Readiness RC interne

rc.1 confirme :

- version alignée sur `v24.0.0-rc.1` ;
- statut Release Candidate interne ;
- absence d’exposition production ;
- absence de version finale ;
- absence de tag automatique ;
- rôles et statuts officiels uniquement ;
- flux métier alpha.12 conservé ;
- gel fonctionnel alpha.13 conservé ;
- consultation Direction/Admin/Lecture seule sans mutation ;
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
