# NIMR SAV React — v24.0.0-alpha.20

Version de recette web isolée, PWA/CSP et audit live avant décision humaine.

Application React + TypeScript pour NIMR Carrosserie SAV.

> Version de rattrapage — cette étape organise le retour en développement alpha après le refus terrain de la rc.1 (NO-GO). Elle n’est pas destinée à la production, n’est pas une version finale/RC, et ne crée aucun tag ni push automatique.

## Écrans par rôle

- Réception SAV : créer et qualifier les dossiers, gérer les sinistres/claims, importer et analyser les devis.
- Planification Atelier : affecter les techniciens, gérer la priorité, organiser les tâches et estimer les charges depuis les devis.
- Espace Technicien : suivre les tâches affectées et valider l’avancement atelier.
- Contrôle Qualité : vérifier la conformité technique et gérer les reprises.
- Livraison Client : préparer la remise, ajouter une preuve et confirmer la livraison.
- Directeur SAV : consulter les KPIs, alertes opérationnelles et charge atelier sans mutation métier.
- Console Administration : consulter la gouvernance, les rôles et les invariants.
- Mode Lecture Seule : consulter passivement sans action d’écriture.

## Version

`v24.0.0-alpha.20` — Recette web isolée / PWA / CSP / service worker recette / audit live.

- alpha.20 est une version alpha de recette web uniquement : ce n’est pas une RC et ce n’est pas une version de production.
- URL recette cible : https://irondrass.github.io/NIMR-SAV-V24-RECETTE/
- URL stable inchangée : https://irondrass.github.io/NIMR-SAV/
- Aucune RC automatique après alpha.20 ; toute nouvelle RC nécessite une décision humaine GO / NO-GO après audit live complet.
- Aucun tag automatique, ni de push automatique.
- Le pilote stable reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement `[]`.
- Le service worker V24 est autorisé uniquement sous `/NIMR-SAV-V24-RECETTE/`.
- Le cache recette est isolé : `nimr-sav-v24-alpha20-recette`.
- Aucun backend ni Supabase ajouté (lot Cloud/Supabase séparé post-alpha).
- Le replay offline reste local/simulé uniquement, sans synchronisation serveur.
- Les lots alpha.14 planning/Gantt, alpha.15 claims/accords, alpha.16 devis/charge atelier, alpha.17 impressions/export/photos et alpha.18 offline/cache/queue/PWA sont conservés.
- `v24.0.0` final reste hors périmètre.

## Roadmap des Lots de Rattrapage Fonctionnel

- **alpha.14** : Planning Atelier Avancé, suggestions de créneaux, collisions, capacité ressources, Gantt.
- **alpha.15** : Multi-sinistres / Claims / Accords Expert & Client.
- **alpha.16** : Import Devis HTML/TXT, Calcul Charge Atelier, Répartition par Pôle.
- **alpha.17** : Impressions & Exports ZIP/PDF.
- **alpha.18** : Mode Offline & PWA.
- **alpha.19** : Durcissement sécurité, validation champs, audit exports/cache/PWA, recette terrain par rôle.
- **alpha.20** (Version courante) : Recette web isolée, manifest PWA, icônes 192/512, CSP, service worker limité au dépôt recette, audit live facilité.
- **Cloud/Supabase** : Synchronisation & Sécurité Cloud (séparé en lot post-alpha).

## Readiness alpha.20

alpha.20 confirme :

- version alignée sur `v24.0.0-alpha.20` ;
- recette publique isolée sous `/NIMR-SAV-V24-RECETTE/` ;
- manifest `manifest.webmanifest`, icônes PNG 192/512, CSP stricte, `noscript` et fallback root ;
- service worker `sw-v24-recette.js` limité au scope recette et au cache `nimr-sav-v24-alpha20-recette` ;
- conservation des audits alpha.19 : permissions/rôles, statuts, validation champs terrain, sécurité export/print, cache/queue ;
- statut de développement alpha de recette (non RC, non production) ;
- absence d’exposition production et absence de version finale ;
- absence de tag ou de push automatique ;
- rôles et statuts officiels uniquement ;
- flux métier alpha.12/13, Gantt alpha.14, claims alpha.15, devis alpha.16, impressions/exports/photos alpha.17 conservés ;
- consultation Direction/Admin/Lecture seule sans mutation ;
- fonctionnement dégradé offline avec avertissements clairs et sauvegarde locale.

## Commandes de validation locale

```bash
npm ci
npm run lint
npm test
npm run build
npm audit --registry=https://registry.npmjs.org/
```

## Handoff validation terrain finale

La validation terrain doit rejouer une journée SAV fictive :

- réception de plusieurs dossiers ;
- import de devis pour les sinistres ;
- affectation atelier & planification ;
- intervention technicien ;
- attente pièces ;
- rejet qualité ;
- reprise atelier ;
- approbation qualité ;
- livraison client ;
- consultation direction/admin/lecture seule.

Critères bloquants : perte de dossier, mutation par lecture seule, livraison sans qualité approuvée, statut incohérent, rôle non autorisé, donnée client réelle, erreur console critique, échec test/build/audit.

## Prochaine étape possible

Audit live complet sur https://irondrass.github.io/NIMR-SAV-V24-RECETTE/ puis décision humaine GO / NO-GO avant toute nouvelle RC éventuelle.
