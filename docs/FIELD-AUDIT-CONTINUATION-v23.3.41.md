# Reprise de l'audit terrain — candidat v23.3.41 (PRINT-07 A4 Pagination)

Date : 10 septembre 2026. Statut : corrections locales prêtes pour revue ; [PR #65](https://github.com/irondrass/NIMR-SAV/pull/65) mise à jour vers candidat v23.3.41 ; aucune fusion ni mise en production.

## Base et préservation des changements utilisateur

SCOPE: V23 LEGACY. SUPABASE IMPACT: NONE (aucune modification SQL, RLS, Auth, Edge Function ou configuration serveur).

Base vérifiée sur `origin/main` : `269bcf535bc314f9fd1e9dd8c050559972ae19e8`, v23.3.39.
Branche : `fix/field-audit-continuation-v2339`. Dossier de travail : `NIMR-SAV-FIELD-AUDIT-CONTINUATION`.
Toutes les modifications préexistantes du dossier `__github_publish_NIMR_SAV` sont conservées ; aucune modification du code React.

## Historique de la version et repackaging

1. **Candidat initial v23.3.40** : Intégration des reprises terrain (absences, actual time, suivi client, 7 impressions atelier). Empreinte scellée : `0250bc08b36c1d77ee557c7ce16f6623e3f8bcfc8514dd5287e7bbb428beee81`.
2. **Détection du défaut visuel PRINT-07** : En format A4 portrait, l'ordre de travail complémentaire (`07-ordre-complementaire`) débordait sur 2 pages, la 2e page contenant principalement « Observations technicien » et les signatures sur une page presque vide.
3. **Correction ciblée P2** : Réduction des espacements verticaux cumulatifs strictement circonscrite à `.supplement-page` dans `js/exports.js` (marges d'en-tête, `h1`, `h2`, paragraphes, tableaux et dimensionnement de `.notes-box` et signatures).
4. **Nécessité du repackaging v23.3.41** : `js/exports.js` fait partie des 23 fichiers de runtime sous contrat d'empreinte `canonical-lf-v2`. L'empreinte v23.3.40 étant scellée et immuable, la modification a exigé la création de la version `v23.3.41` pour garantir l'intégrité PWA et éviter toute pollution de cache.

## Changements intégrés v23.3.41

- **PRINT-07 A4 portrait** : Ordre de travail complémentaire compacté pour tenir sur exactement une page A4 portrait avec données de démonstration.
- **Préservation intégrale du contenu métier** :
  - Références dossier et OR (`OR-DEMO-040`)
  - Identification client et véhicule (`123 TU 456`, zone train avant)
  - Motif et dommage découvert (« Contrôle à froid »)
  - Suivi atelier et intégration planning
  - Tableau d'impact atelier/client
  - Tableaux pièces et main-d'œuvre complémentaires
  - Section « Observations technicien » avec cadre de notes
  - Grille des signatures (« Signature technicien » et « Validation chef atelier »)
- **Identité de version v23.3.41** : Alignement strict des 7 fichiers de déclaration (`js/version.js`, `js/state.js`, `sw.js`, `index.html`, `offline.html`, `app.js`, `js/estimate-import.js`).

## Vérification et preuves

Commandes exécutées depuis le dossier de travail :

| Vérification | Résultat |
|---|---|
| Test ciblé pagination PRINT-07 (`tests/field_print_07_pagination.test.mjs`) | **PASS** — pageCount = 1, 0 overflow horizontal, 0 clipping, A4 portrait |
| Impressions atelier (`tests/field_prints.test.mjs`) | **10/10 PASS** — les 7 modèles conformes |
| Sécurité exports et durcissement (`tests/security_exports_pin_supabase_v2322.test.mjs`) | **PASS** — v23.3.41 validé |
| Tests cohérence cache/version PWA (`tests/pwa_deploy_asset_version_consistency_cache001.test.mjs`) | **49/49 PASS** — suppression anciens caches, persistance du cache `nimr-sav-v23.3.41`, contrat `isReleaseAsset` |
| Portabilité empreinte (`tests/release_fingerprint_portability.test.mjs`) | **10/10 PASS** — équivalence LF/CRLF |
| Harnais navigateur CDP 1 (`tests/audit_completion_browser.test.mjs`) | **PASS** (360px, 390px, 430px sans débordement) |
| Harnais navigateur CDP 2 (`tests/mobile_offline_recovery.test.mjs`) | **PASS** (profil mobile simulé) |
| Harnais navigateur CDP 3 (`tests/mobile_orientation_keyboard.test.mjs`) | **PASS** (rotations et clavier) |
| Harnais navigateur CDP 4 (`tests/mobile_pwa_resume.test.mjs`) | **PASS** (reprise d'application) |
| Benchmark DAG (`tests/workshop_001b_dependency_dag.test.mjs`) | 34 scénarios fonctionnels et gardes réussis ; benchmark 60 lignes à 42,8 ms (>25 ms) : **NON-REGRESSIVE BASELINE GATE FAILURE** |
| Contrôle de syntaxe (`git diff --check`) | **PASS** |

## Empreintes de publication

- **v23.3.40 (conservée immuable)** : `0250bc08b36c1d77ee557c7ce16f6623e3f8bcfc8514dd5287e7bbb428beee81`
- **v23.3.41 (nouvelle empreinte scellée)** : `4ca539ad9125425230dd7360ee42dd82b6d95237f55f3e5abf949a65b8a94e29`
- **Schéma** : `canonical-lf-v2`
- **Nombre de fichiers de runtime** : 23

## Statut des Gates

- GATE: AUTOMATED A4 PAGINATION (PRINT-07) | **PASS** (1 page A4 via headless Chromium CDP `Page.printToPDF`)
- GATE: NATIVE USER PRINT DIALOG / PHYSICAL PDF | **NOT VERIFIED** (export natif utilisateur Ctrl+P dépendant du pilote d'impression local)
- GATE: SUITE NAVIGATEUR CDP | **PASS** (4/4 harnais exécutés avec succès)
- GATE: PERFORMANCE DAG | **NON-REGRESSIVE BASELINE GATE FAILURE** (seuil 25 ms dépassé sur la ligne de base v39)
- GATE: REVUE DISTANTE | **AVAILABLE** (PR #65)
- GATE: LIAISON COMPTE-TECHNICIEN EN PRODUCTION | **NOT VERIFIED** (Edge Function non redéployée)
