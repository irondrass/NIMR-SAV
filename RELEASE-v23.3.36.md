# NIMR-SAV v23.3.36 — Remédiation Audit Terrain & Robustesse Atelier

7 septembre 2026. Base : v23.3.35, `608b26d7bdfbb581be6a6e9b4027fbbcbcc0d8c2`.

Cette version packagée v23.3.36 intègre la remédiation complète de l'audit terrain (FIELD-AUDIT) : extraction exhaustive des devis PDF (137/137 lignes), liaison robuste des comptes techniciens aux ressources d'atelier, prévention stricte des doublons d'ordre de réparation (OR), et alignement du contrat client/serveur pour la fonction d'administration des utilisateurs d'atelier.

---

## 1. Périmètre des Corrections & Améliorations

### A. Extraction Exhaustive des Devis PDF (137/137)
- **Problème résolu** : Sur les devis PDF complexes à forte densité ou sur plusieurs pages, des lignes de totalisation ou des libellés fractionnés n'étaient pas correctement isolés des lignes d'opérations élémentaires.
- **Remédiation** : `js/estimate-import.js` extrait désormais 100 % des opérations unitaires (137/137 vérifiées sur le jeu d'essai standardisé), sépare strictement les totaux intermédiaires, et assure la validation des taux horaires et forfaits sans perte d'information.

### B. Liaison de Compte Technicien sans Email Vide
- **Problème résolu** : L'association d'un utilisateur d'atelier à une ressource technicien pouvait échouer ou produire des incohérences si l'adresse email n'était pas formellement renseignée lors de la création du compte.
- **Remédiation** : Validation renforcée dans `supabase/functions/workshop-user-admin/index.ts` et `js/supabase-client.js`. L'email est validé obligatoirement avant toute création ou liaison, et la ressource est synchronisée avec l'ID utilisateur de manière atomique. L'interface dans `js/ui-planning.js` et `js/ui-cases.js` signale explicitement les techniciens non encore raccordés à un compte actif.

### C. Prévention des Doublons d'Ordres de Réparation (OR)
- **Problème résolu** : Les requêtes concurrentes ou les réessais intempestifs en mode déconnecté pouvaient tenter de recréer un OR portant le même numéro ou la même référence dossier.
- **Remédiation** : Validation de non-duplication et gestion propre des conflits d'unicité avec idempotence client (`idempotency_key` / vérification préalable de numéro d'OR existant) dans `js/business-rules-v2187.js` et `js/ui-cases.js`.

### D. Alignement Contrat Client/Serveur (Edge Function `workshop-user-admin`)
- **Problème résolu** : Divergence entre les paramètres attendus par la fonction Edge et ceux transmis par le client d'administration des utilisateurs.
- **Remédiation** : Alignement strict des signatures de payload pour `create_user`, `update_user`, `link_technician`, et `unlink_technician`.

---

## 2. Sécurité & Contrôle d'Accès (RBAC)

- **Restriction des Rôles Appelants** : L'Edge Function `workshop-user-admin` restreint strictement les opérations d'administration aux seuls utilisateurs disposant du rôle `admin` ou `responsable_sav`, vérifié côté serveur via le JWT Supabase.
- **Liaison/Déliaison Atomique avec Concurrence Optimiste (CAS)** : L'association d'un technicien à un compte auth vérifie le verrouillage de concurrence optimiste (`version` / CAS) pour interdire tout écrasement concurrent ou double assignation silencieuse.
- **Audit Trail** : Traçabilité des modifications d'affectation et d'attribution de rôle.

---

## 3. Empreinte de Déploiement & Intégrité PWA

- **Version Applicative** : `v23.3.36`
- **Nom de Cache Service Worker** : `nimr-sav-v23.3.36`
- **Empreinte Canonique Runtime (23 fichiers, schéma `canonical-lf-v2`)** :
  `6e90dfc5c83614ddf8f47c7ab60b919c5090477fcc860f4983c911ace6075016`
- **Historique Scellé** : Intégrité préservée byte-par-byte pour l'ensemble des versions antérieures scellées (`v23.3.21` à `v23.3.35`).

---

## 4. Fichiers Modifiés & Rôles

| Fichier | Nature | Description |
| :--- | :--- | :--- |
| `js/version.js` | Versioning | Déclaration officielle de version `v23.3.36`, build et cache. |
| `js/state.js` | Runtime PWA | Alignement `APP_VERSION = "v23.3.36"`. |
| `app.js` | Runtime PWA | Requête versionnée PDF worker et SW registration `?v=23.3.36`. |
| `index.html` | Shell PWA | Mise à jour des balises de scripts et styles vers `?v=23.3.36`. |
| `offline.html` | Shell Hors Ligne | Mise à jour de la feuille de style vers `styles.css?v=23.3.36`. |
| `sw.js` | Service Worker | Alignement `CACHE_NAME`, liste d'actifs `?v=23.3.36`, `isReleaseAsset`. |
| `js/estimate-import.js` | Fonctionnel / Métier | Extraction exhaustive 137/137 opérations PDF et isolation des totaux. |
| `js/supabase-client.js` | Intégration Client | Appels Edge Function `workshop-user-admin` et gestion d'idempotence. |
| `js/ui-cases.js` | Interface Utilisateur | Conduite de dossier, affichage des alertes OR et rattachement technicien. |
| `js/ui-planning.js` | Interface Utilisateur | Diagnostic des comptes techniciens non liés dans l'équipe planning. |
| `supabase/functions/workshop-user-admin/index.ts` | Edge Function | RBAC serveur, validation email obligatoire, liaison atomique CAS. |
| `tests/helpers/release-fingerprint.mjs` | Harness Déploiement | Enregistrement de l'empreinte canonique scellée `v23.3.36`. |
| `tests/pwa_deploy_asset_version_consistency_cache001.test.mjs` | Tests Contrat PWA | Validation des 49 tests de consistance de cache et anti-régression. |
| `tests/estimate_regression.mjs` | Tests Import | Régression d'extraction devis PDF (137/137 opérations). |
| `tests/field_audit_import.test.mjs` | Tests Import | Vérification unitaire de l'extraction multi-lignes et multi-pages. |
| `tests/field_audit_account_link.test.mjs` | Tests Authentification | Vérification de la liaison technicien, RBAC et CAS. |
| `docs/audit-ux-metier-2026-09-05.md` | Documentation | Rapport d'audit de terrain de référence. |

---

## 5. Statut des Migrations & Services Supabase

- **Code Local Edge Function** : Mis à jour localement dans `supabase/functions/workshop-user-admin/index.ts`.
- **Déploiement Edge Function Live** : **NON EXÉCUTÉ** (Aucune commande `supabase functions deploy`).
- **Mutation Schéma / Données Live** : **AUCUNE MUTATION EXÉCUTÉE** (Aucun DDL, DML, migration ou modification de secrets en production distante).
