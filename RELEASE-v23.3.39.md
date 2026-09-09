# NIMR-SAV v23.3.39 — Robustesse de l'expérience de résolution des conflits et réconciliation de l'outbox

9 septembre 2026. Base : v23.3.38, `308d051dd1eb3679051cf2c95e124c8a44917efe`.

Cette version délivre les correctifs d'accessibilité, d'ergonomie orientée rôles, et de cohérence transactionnelle de l'outbox durable pour le ticket F19-SYNC-CONFLICT-UX-001.

## 1. Contexte & Problèmes résolus

Dans la gestion des conflits de synchronisation hors ligne et multi-postes :

- **Défaut C (Découvrabilité des conflits outbox)** : Dans `app.js` (`renderActivityLog`), la visibilité du panneau de conflit `#panel-activity-log` reposait uniquement sur `getOpenSyncConflicts().length`. Si un conflit ne résidait que dans l'outbox durable, le panneau était masqué pour les utilisateurs ne disposant pas du droit `audit.view`.
  - *Correctif* : Le calcul de visibilité prend désormais en compte les entités groupées issues à la fois de l'état mémoire et du miroir d'outbox durable (`groupConflictedEntities(openConflicts, outbox)`), tout en maintenant strictement inaccessibles et masqués les éléments du journal d'activité (`display: none` sur filtres, recherche, tableau) pour préserver la confidentialité.
- **Défaut D (Guidage contextuel pour les rôles non-gestionnaires)** : Les rôles opérationnels (réception, technicien, contrôle qualité) voyaient s'afficher sur le bandeau de synchronisation une invite cliquable *"Résoudre"* et un bouton de secours *"Résoudre le conflit"* inutilisables menant à une impasse de navigation faute de droits atelier.
  - *Correctif* : L'accès aux actions de résolution est conditionné par `canAccessTab("atelier")`. Pour les profils non-gestionnaires, le badge affiche un statut informatif de sécurité : `"— [N] conflit(s) détecté(s) — Chef Atelier requis"`. L'interactivité du badge (clic, focus clavier) est désactivée et le bouton de repli est masqué.
- **Défaut F (Accessibilité et priorité du focus)** : La fonction `navigateToConflictsAndFocus()` ciblait le premier bouton du panneau, plaçant le focus sur le bouton de téléchargement de sauvegarde de sécurité (`data-sync-conflict-download-id`) plutôt que sur une action de décision (`data-sync-conflict-action`).
  - *Correctif* : La priorité de sélection cible expressément `[data-sync-conflict-action]:not([disabled])`. En l'absence d'action active, le focus se reporte sur le conteneur du panneau avec `tabindex="-1"`.
- **Défaut H (Réconciliation de l'outbox durable après résolution serveur)** : Lors de la réconciliation automatique des conflits résolus sur le serveur (`reconcileServerResolvedConflicts`), le conflit était marqué comme résolu dans l'état mémoire local, mais l'opération historique correspondante restait bloquée avec le statut `"conflicted"` dans l'outbox durable, maintenant un conflit fantôme visible.
  - *Correctif* : Lorsqu'une ligne de conflit résolue sur le serveur correspond exactement par `local_operation_id` à une opération de l'outbox durable en statut `"conflicted"` ou `"conflict"` avec correspondance d'atelier et d'entité, celle-ci est formellement et atomiquement acquittée via l'API standard `acknowledgeDurableOutboxOperation`. Le repli historique sur entité seule continue de réconcilier l'état mémoire sans jamais supprimer arbitrairement d'opération d'outbox.
- **Défaut I (Sémantique des résolutions en attente de synchronisation)** : Lors d'une résolution `keep_local`, l'état restait ouvert en attente d'acquittement (`pendingResolution: true`, `resolutionStage: "awaiting_ack"`), mais le bandeau continuait d'afficher un avertissement d'action *"Résoudre"* en contradiction avec les boutons d'action désactivés.
  - *Correctif* : Le bandeau distingue les conflits actionnables nécessitant une décision humaine de ceux déjà arbitrés en attente d'envoi cloud, en affichant : `"— [N] résolution(s) en attente"`.

### Clarification sur le Scénario B
Le scénario B a été formellement audité et documenté comme un comportement de cohérence purement informationnel et non comme un défaut fonctionnel de production : la consolidation d'opérations multiples d'une même entité en un unique groupe actionnable est conforme au modèle métier et ne provoque aucune divergence d'actionnabilité.

## 2. Frontières de sécurité & Règles Fail-Closed

- **Confidentialité du journal d'audit** : Aucun journal, historique ou tableau d'événements n'est exposé aux rôles ne possédant pas `audit.view`.
- **RBAC et barrière atelier** : Aucun rôle non-gestionnaire ne peut déclencher les actions de résolution ni accéder à des panneaux d'administration.
- **Protection des dossiers en conflit** : Toute tentative de mutation sensible sur un dossier en conflit (`case.edit`, `planning.edit`, `task.start`, etc.) reste formellement bloquée jusqu'à l'acquittement cloud définitif (validé par Scénario J).
- **Disponibilité des dossiers non-conflictuels** : Les opérations sur les dossiers sains non conflictuels restent pleinement autorisées (validé par Scénario K).
- **Règle stricte d'acquittement outbox** : Seule une opération prouvée (`local_operation_id === operationId`, statut conflicted/conflict, atelier et entité identiques) peut être acquittée lors de la réconciliation serveur. Le repli entité seule ne supprime jamais d'opération outbox.
- **Fail-visible sur erreur d'acquittement** : Toute anomalie d'écriture ou d'acquittement outbox est remontée dans le résultat retourné (`{ reconciled, error, settlementError }`).

## 3. Tests et validation

- `tests/sync_conflict_ux_p1_matrix.test.mjs` : **13/13 scénarios PASS (19 subtests)**
  - Scénario A : Témoin de contrôle et résolution gestionnaire
  - Scénario B : Validation du groupement d'entités
  - Scénario C : Visibilité outbox-only sans `audit.view`
  - Scénario D : Non-gestionnaires et guidage Chef Atelier requis
  - Scénario E : Navigation et droits gestionnaires
  - Scénario F : Priorité du focus sur décision, pas sur sauvegarde
  - Scénario G : Exclusion des conflits résolus
  - Scénario H : Réconciliation et acquittement outbox (H1 exact match, H2 préservation autre opération, H3 préservation pending, H4 préservation outbox en repli entité, H5 préservation sur mismatch, H6 fail-visible sur erreur de stockage)
  - Scénario I : Sémantique de résolution en attente
  - Scénario J : Blocage des mutations sensibles sur dossier conflictuel
  - Scénario K : Autorisation des mutations sur dossier non-conflictuel
  - Scénario L : Règlement de groupe outbox conflictuel
  - Scénario M : Stabilité au rechargement / réhydratation
- `tests/sync_conflict_reconcile_and_collapse_sync002.test.mjs` : **29/29 PASS**
- `tests/sync_conflict_badge_usability_v2324.test.mjs` : **PASS**
- `tests/offline_sync_conflict_local_data_integrity_v2323.test.mjs` : **PASS**
- `tests/sync_role_transport_001.test.mjs` : **PASS**
- `tests/realtime_authenticated_lifecycle_p0013.test.mjs` : **PASS**
- `tests/mobile_offline_recovery.test.mjs` : **PASS**
- `tests/offline_auth_001.test.mjs` : **13/13 PASS**
- `tests/pwa_cache_version_contract.test.mjs` : **PASS**
- `tests/pwa_deploy_asset_version_consistency_cache001.test.mjs` : **49/49 PASS**
- `tests/release_fingerprint_portability.test.mjs` : **10/10 PASS**

## 4. PWA et identité de release

- Version applicative : `v23.3.39`
- Cache Service Worker : `nimr-sav-v23.3.39`
- Query d'assets runtime : `?v=23.3.39`
- Schéma d'empreinte : `canonical-lf-v2`
- Empreinte canonique runtime :
  `f28c265de9e4520596329dc54cde69fb5b7064bd71c8dd127e1227ebb52c9454`
- Toutes les empreintes scellées antérieures (v23.3.21 à v23.3.38) restent intègres et scellées.

## 5. Supabase et déploiement

- **SUPABASE IMPACT: NONE**
- Aucune modification de schéma SQL (`supabase-schema.sql` inchangé).
- Aucune mutation SQL distante ou migration.
- Aucun changement dans les règles RLS ou les Edge Functions.
- Aucun déploiement live dans ce commit.
