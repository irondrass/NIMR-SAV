# NIMR-SAV v23.3.42 — Préservation des brouillons de réparation complémentaire

11 septembre 2026. Base : v23.3.41, `390ea540dd88d09e6a8af7995a50604873aa397b`.

Cette version délivre le correctif de persistance éphémère du formulaire d'ordre de réparation complémentaire pour le ticket **SUPPLEMENT-FORM-DRAFT-001**.

---

## 1. Contexte & Problème résolu

- **Ticket** : `SUPPLEMENT-FORM-DRAFT-001`
- **Scope** : `V23 LEGACY`
- **Cause racine** :
  Le brouillon de saisie d'un ordre de réparation complémentaire (`#supplement-form`) résidait exclusivement dans les champs du DOM sans aucun état temporaire conservé avant validation.
  Lorsqu'un rendu global (`render()`) ou local (`renderCaseDetail()`) survenait pendant la rédaction (ex. rafraîchissement d'état, synchronisation cloud, mise à jour d'un statut en tâche de fond), l'élément `#case-detail` était vidé via `.replaceChildren(...)` et reconstruit à partir du template HTML, réinitialisant tous les champs non soumis et causant une perte irréversible de la saisie utilisateur.

- **Correctif chirurgical (`js/ui-cases.js`)** :
  - Mise en place d'un magasin en mémoire éphémère (`supplementDraftsByCaseId = new Map()`) indexé par identifiant de dossier (`caseId`).
  - Capture continue des saisies sur `#supplement-form` via écouteurs d'événements `input` et `change` sur tous les champs : `title`, `vehicleArea`, `status`, `phase`, `reason`, `operation`, `laborHours`, `parts`.
  - Nettoyage automatique de la clé si tous les champs redeviennent vides (`isSupplementDraftEmpty`).
  - Restauration automatique et transparente des valeurs enregistrées lors de l'exécution de `renderCaseDetail(targetCase)`.
  - Le brouillon survit à tous les re-rendus globaux (`render()`) et locaux (`renderCaseDetail()`).
  - Le brouillon survit aux échecs de validation (ex. champ manquant ou heure invalide).
  - Le brouillon est purgé du magasin éphémère uniquement en cas de soumission réussie (`handleSupplementSubmit`) ou de réinitialisation explicite (`reset`).
  - **Frontière stricte d'isolation** :
    - Le magasin de brouillons n'est **jamais** sérialisé dans `localStorage` ni dans `saveState()`.
    - Aucune trace de brouillon ne s'immisce dans l'objet global `state`.
    - Aucun risque de fuite ou de persistance involontaire après rechargement de page / nouvelle session.
    - Aucune contamination croisée entre dossiers : l'isolation par `caseId` garantit qu'un brouillon sur le dossier A n'apparaît jamais sur le dossier B.

---

## 2. Couverture de tests & Validation

- **Suite dédiée** : `tests/supplement_form_draft_001.test.mjs`
  - Survie de tous les champs après déclenchement de `render()`.
  - Survie de tous les champs après déclenchement direct de `renderCaseDetail()`.
  - Préservation intégrale du brouillon après rejet de validation.
  - Création exacte d'un seul supplément et purge unitaire du brouillon après soumission valide.
  - Isolation stricte entre dossiers : le brouillon du dossier A ne pollue pas le dossier B.

- **PWA Déploiement & Cohérence de cache** :
  - `tests/pwa_deploy_asset_version_consistency_cache001.test.mjs` : **49/49 PASS**
  - `tests/pwa_cache_version_contract.test.mjs` : **PASS**
  - `tests/release_fingerprint_portability.test.mjs` : **10/10 PASS**

---

## 3. PWA & Identité de release

- **Version applicative** : `v23.3.42`
- **Build ID** : `23.3.42`
- **Cache Service Worker** : `nimr-sav-v23.3.42`
- **Query d'assets runtime** : `?v=23.3.42`
- **Toutes les 7 surfaces de production alignées** :
  1. `js/version.js`
  2. `js/state.js`
  3. `index.html`
  4. `offline.html`
  5. `app.js`
  6. `js/estimate-import.js`
  7. `sw.js` (les 29 entrées `ASSETS` et filtre `isReleaseAsset`)
- **Schéma d'empreinte** : `canonical-lf-v2`
- **Empreinte scellée v23.3.42** :
  `90a07b4e0f5f229c57e411d04b27dac62ed4a19d26a4974421cee6c324da5d03`
- Toutes les empreintes historiques (v23.3.21 à v23.3.41) restent scellées et immuables.

---

## 4. Résultats de l'Audit Canonique de Release

Exécution de `node tests/run-audit-release.mjs` :
- **Invocation A (Suites fonctionnelles)** : **PASS**
  - Inclut `supplement_form_draft_001` dans l'orchestration canonique.
  - Zéro régression sur l'ensemble des suites PWA, synchronisation, sécurité et métier.
- **Invocation B (Benchmark DAG isolé)** : **PASS**
  - Exécution en processus enfant isolé.
  - Tailles de benchmarks : 10, 30, 60, 100 lignes de devis.
  - Toutes les moyennes strictement < 25.0 ms.

---

## 5. Frontières de sécurité & Statut des fichiers protégés

- **SUPABASE IMPACT: NONE**
  - 0 modification de schéma SQL (`supabase-schema.sql` inchangé).
  - 0 mutation distante, migration ou altération de tables.
  - 0 modification des politiques RLS.
  - 0 Edge Function touchée ou déployée.
  - 0 opération sur la base de données de production.
- **Statut des fichiers protégés** :
  - `js/planning.js` : INTACT
  - `js/business-rules-v2187.js` : INTACT
  - `js/storage.js` : INTACT
  - `js/supabase-sync.js` : INTACT
  - `js/supabase-client.js` : INTACT
  - `supabase-schema.sql` : INTACT
  - `apps/nimr-sav-react/` : INTACT
