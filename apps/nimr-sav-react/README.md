# NIMR SAV React — v24.0.0-alpha.19

Version de durcissement sécurité, recette terrain interne et audit avant décision humaine.

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

`v24.0.0-alpha.19` — Durcissement sécurité / recette finale interne / audit terrain avant nouvelle RC éventuelle.

- alpha.19 est une version alpha interne uniquement : ce n’est pas une RC et ce n’est pas une version de production.
- Aucune RC automatique après alpha.19 ; toute nouvelle RC nécessite une décision humaine GO / NO-GO.
- Aucun tag automatique, ni de push automatique.
- Le pilote stable reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement `[]`.
- React v24 reste sans service worker actif par défaut ; le diagnostic PWA est isolé.
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
- **alpha.19** (Version courante) : Durcissement sécurité, validation champs, audit exports/cache/PWA, recette terrain par rôle.
- **Cloud/Supabase** : Synchronisation & Sécurité Cloud (séparé en lot post-alpha).

## Readiness alpha.19

alpha.19 confirme :

- version alignée sur `v24.0.0-alpha.19` ;
- audit permissions/rôles, audit statuts, validation stricte champs terrain, sécurité export/print, durcissement cache/queue et diagnostic PWA isolé ;
- statut de développement alpha de durcissement (non RC, non production) ;
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

Décision humaine GO / NO-GO avant toute nouvelle RC éventuelle, après validations locales, clone frais GitHub, smoke navigateur, tests v23.2.6 et validation terrain manuelle.
