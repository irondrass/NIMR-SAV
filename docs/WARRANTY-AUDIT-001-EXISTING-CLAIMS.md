# KHA-52 — WARRANTY-AUDIT-001 : cartographie des claims et de la garantie existants

Date : 2026-09-30. Référence : origin/main `6a0308efe4f6f438dea48ab56e2e64c52edb3b2c`.
Nature : audit lecture seule. Aucun SQL DDL/DML, migration, secret, déploiement ni modification métier exécutés.

## 1. Architecture / sources de vérité actuelles

| Couche | Fichiers / source | Acquis vérifié | Limite OEM |
|---|---|---|---|
| PWA opérationnelle v23 | `js/state.js:3900+`, `js/ui-cases.js:4500+` | `item.claims` par OR, type, statut, accord client/expert, autorisation travaux, devis, MO et suppléments | `normalizeRepairClaim` reconstruit explicitement les champs : toute extension OEM non inscrite serait perdue à la normalisation |
| Synchronisation PWA → Supabase | `js/supabase-sync.js:676-785` | upsert `repair_claims`, `repair_claim_labor_lines`, `repair_supplements` par identifiants locaux liés à l'OR | projection ne persiste pas l'état OEM ni l'état financier distinct ; nécessité d'une stratégie anti-écrasement legacy |
| React v24 (fondation / recette) | `apps/nimr-sav-react/src/domain/claims.ts`, `sav-case.ts` | `insurance/customer/warranty/internal/mixed`, validations, rejets, annulations, approbation planning | garantie `warranty` = validation interne principalement ; pas de décision constructeur/lignes OEM |
| Store v24 | `apps/nimr-sav-react/src/state/sav-case-store.ts:960-1190` | créer / modifier / approuver / rejeter / annuler claim et override admin avec journal local | persistance principalement localStorage ; audit `createAuditLog` applicatif distinct de preuve serveur OEM |
| Gouvernance v24 | `action-permissions.ts:56-166` | admin tout, réception/chef gestion claims, réception validations expert/client ; override réservé admin | pas de rôle métier Garantie ni de permissions par transition OEM |
| Planning v24 | `workflow-engine.ts:96-109`, `claims.ts:85-132` | un claim non approuvé bloque l'entrée atelier, override admin audité | `status=approved` warranty ne signifie pas autorisation OEM ; ne pas rendre la facturation/acceptation OEM équivalente au droit de réparer |
| Backend | tables `repair_orders`, `repair_claims`, `repair_claim_labor_lines`, `repair_supplements`, `audit_logs` | `workshop_id` + RLS, identifiants UUID, liens OR/claim, contrôle de version et horodatage | absence d'autorité serveur spécifique OEM ; écriture générique encore ouverte aux rôles Réception/Chef |

La PWA v23 et React v24 n'ont pas un modèle Claim identique : PWA `type` (`assurance`, etc.) / React `claimType` (`insurance`, `warranty`, etc.). Définir une traduction explicite, versionnée et testée avant toute extension ; pas de migration implicite par simple changement de libellé.

### 1.1 — Incompatibilité réelle des statuts à conserver

La PWA v23 (`js/state.js:183-191`) accepte `draft`, `expert_pending`, `client_pending`, `approved` (libellé **Prêt planning**), `refused`, `planned`, `done`. Le type Claim React v24 (`sav-case.ts:142`) accepte `draft`, `estimate_pending`, `expert_pending`, `client_pending`, `approved`, `rejected`, `cancelled`. En particulier `refused` ≠ `rejected` sans adaptation contrôlée, et `planned`/`done` ne doivent pas devenir silencieusement `draft` lors d'un aller-retour entre clients. `approved` reste un statut interne de planning, **jamais une approbation constructeur par défaut**. Prévoir une table explicite de compatibilité avec cas non mappables bloqués et tests round-trip avant écriture OEM.

## 2. Schéma actuel réellement vérifié

Sources : consultation du catalogue PostgreSQL en lecture seule de `NIMR-SAV-PROD-V2` (`mkecnwolvzgxltrasbmr`) et `NIMR-SAV-QC-PRO-STAGING` (`ijgstcdptyxjzgqlvooc`), complétée par `supabase/migrations/20260827081041_nimr_sav_v23_2_8_full_audit.sql:184-231,439-446,583-614`.

| Table | Colonnes / relations réutilisables | Écart |
|---|---|---|
| `repair_claims` | UUID, workshop_id, repair_order_id, local_id, number, title, type, status, inclusion planning, approbations expert/client, amount, source_file, version/auteurs/dates | aucun `oem_status`, `payment_status`, décision OEM, approbation fournisseur ou montant demandé/accepté indépendant |
| `repair_claim_labor_lines` | claim_id, source_line_id/index/reference, phase, operation, labor_hours, raw_text | pas de décision ni de montant OEM par ligne ; FK vers claim en `ON DELETE CASCADE` : protéger la conservation des lignes après soumission |
| `repair_supplements` / `repair_supplement_lines` | repair_order_id, claim_id optionnel, parts jsonb, lignes MO, statut/intégration | aucun circuit constructeur propre ; `repair_supplements.claim_id` est `ON DELETE SET NULL`, donc un claim supprimé détache les preuves associées |
| `repair_orders` / `vehicles` / `clients` | OR et identité véhicule/client existantes | ne pas cloner OR, VIN, immatriculation ni kilométrage ; référencer les objets canoniques |
| `audit_logs` | repair_order_id, action, before_data/after_data, actor, workshop_id, version/timestamps | audit client ≠ décision OEM prouvée ; voir section 3 |
| `photos` | PROD : lien OR et métadonnées legacy ; STAGING : claim_id, vehicle_id, step/task, media_type, business_context, Drive IDs, checksum, upload state | MEDIA additive staging non promue PROD ; la FK STAGING `photos.claim_id` est `ON DELETE SET NULL`, donc geler les liens de preuve avant soumission OEM |

Les deux environnements ont le socle `repair_claims` / MO / suppléments. L'absence de colonnes OEM citées a été constatée dans les deux catalogues consultés. Les noms / types réels du schéma prévalent sur les anciens documents de pré-audit.

## 3. Autorité, RLS et risques à lever avant KHA-53

1. **RLS actuelle** : activée pour claims, lignes MO, suppléments, photos et audit. SELECT limité au membre workshop. INSERT/UPDATE génériques pour admin_technique/directeur/chef_atelier/reception sur claims, MO et suppléments ; DELETE réservé aux rôles plus élevés. Ce niveau ne suffit pas à protéger `oem_status` / `payment_status` sensibles une fois ajoutés. Créer un contrat serveur à transitions et privilèges restreints **et fermer la mutation générique des champs protégés** (révocation/permissions de colonnes, guard serveur ou architecture équivalente vérifiée) : ajouter seulement un RPC tout en laissant l'UPDATE générique ouvert ne protège rien. Tout RPC privilégié doit vérifier identité, workshop, rôle, transition, concurrence, et avoir `search_path` fixé, accès EXECUTE limité et audit transactionnel.
2. **Liens cross-workshop** : les FK consultées relient `claim_id` à `repair_claims(id)` et `repair_order_id` à `repair_orders(id)`, pas le couple `(workshop_id,id)`. Le trigger `nimr_keep_workshop_scope` interdit le changement de `workshop_id` en UPDATE, mais ne compare pas le workshop de la ligne à celui de la cible. C'est un **risque structurel établi par le catalogue**, pas une exploitation prouvée : reproduire des tests INSERT/UPDATE cross-workshop avec comptes de test uniquement en STAGING, puis renforcer les contraintes / guards si nécessaire avant activation OEM.
3. **Audit** : `nimr_stamp_client_audit_log` impose l'acteur et marque la source `client_asserted` ; la description `before_data/after_data` reste d'origine client. Un horodatage et un acteur estampillés côté base **n'attestent pas** l'exactitude d'une réponse constructeur déclarée par le client. Les décisions OEM et financières doivent créer une preuve dans la même transaction serveur que la transition, avec provenance de la pièce constructeur, horodatage serveur et historique non destructif ; préserver les journaux existants.
4. **Bypass** : `claimsOverridden` / override admin déjà présents dans v24 et `recordWorkAuthorization` / référence d'accord présents dans v23. Ne jamais transformer le bypass planning ni un accord client en approbation/paiement constructeur. Chaque exception doit avoir sa portée, auteur, motif et audit.
5. **Projection legacy** : `js/supabase-sync.js` upsert les champs d'origine, pas les futures extensions. Tester qu'un sync v23 ne remet pas à zéro une décision OEM et qu'un export/import conserve les références, sans faire du client l'autorité du paiement.
6. **Preuve média** : KHA-46..51 définissent le stockage Drive fail-closed, l'intégrité, le gel et les exceptions warranty. KHA-56 doit lier claim/OR sur les lignes canoniques et rester derrière le gate de déploiement média.
7. **Conservation des liens** : les FK constatées sont `repair_claim_labor_lines.claim_id ON DELETE CASCADE`, `repair_supplements.claim_id ON DELETE SET NULL` et, en STAGING, `photos.claim_id ON DELETE SET NULL`. Une suppression physique du claim peut effacer les lignes MO ou détacher des preuves : après soumission OEM, utiliser un gel métier effectif côté serveur et une procédure de rectification auditée, sans cascade destructrice d'un dossier de preuve. Contrôler aussi les règles de suppression de l'OR parent.

### 3.1 — Revue contradictoire : écarts reproduits localement (bloquants avant KHA-53)

Les 24 tests claims préexistants passent, **mais ne couvrent pas trois chemins** reproduits dans un test Vitest temporaire exécuté sur un store fictif, sans connexion à PROD : 3/3 reproductions PASS (27/27 avec le baseline).

1. **`mixed` non bloqué** : `normalizeClaim({claimType:'mixed', status:'draft'})` donne `isClaimApprovedForPlanning=false`, mais `getBlockingClaimsReasons([claim])=[]` ; cette dernière fonction est appelée par le moteur planning/workflow. Le type `mixed` manque dans sa branche de validation. Ajouter une politique explicite pour les claims mixtes et des tests négatifs de démarrage atelier.
2. **Approbation warranty par modification générique** : `savCaseStore.updateClaim(..., {status:'approved'}, actor=chef-atelier)` réussit et supprime les motifs bloquants, bien que les actions spécialisées expert/client soient interdites à ce rôle. `updateClaim` accepte `Partial<Claim>` sans liste blanche de champs sensibles.
3. **Accords insurance par modification générique** : le même acteur peut appeler `updateClaim(...,{expertApproved:true,clientApproved:true})` et rendre les contrôles planning satisfaits, sans passage par les actions d'accord spécialisées. Ne pas assimiler les validations UI à une garantie d'autorisation sur la mutation du store.

Ces preuves caractérisent le **comportement courant du code React/localStorage**. Elles ne démontrent ni exploit à distance, ni modification via RLS en PROD. Avant tout workflow constructeur : contrôler les champs modifiables par rôle et par transition, refuser les modifications directes des accords/statuts sensibles, appliquer le même contrôle côté serveur, conserver l'audit, puis tester les scénarios négatifs (y compris `mixed`).

## 4. Écarts fonctionnels OEM par lot, sans second système

| Lot | Extension proposée (additive, à concevoir / reviewer) | Réemploi obligatoire |
|---|---|---|
| KHA-53 CORE | dossier constructeur sur `repair_claims` existant ; conserver `repair_claims.status` comme état interne canonique (`claim_status` peut être un alias API dérivé, **pas un deuxième champ éditable**) ; ajouter séparément `oem_status` et `payment_status` ; VIN/OR/identité via références canoniques | repair_orders, vehicles, clients, `repair_claims`, mapping v23↔v24 |
| KHA-54 PREAUTH | demande/réponse constructeur, décision datée, références et périmètre des travaux autorisés | approbation travaux existante, pas équivalence avec accord client |
| KHA-55 LINES | lignes MO/pièces avec montant demandé, accepté, refusé et motif par ligne (devise/taxes définies) | repair_claim_labor_lines, suppléments et flux pièces canoniques à cartographier avant toute nouvelle table |
| KHA-56 EVIDENCE | références de preuves liées claim/OR/opération/ligne, checksum et audit | photos/MEDIA-DRIVE, pas de stockage parallèle |
| KHA-57 REVIEW | checklist Garantie NIMR, contrôle données, pièces et preuves avant soumission | dossier existant |
| KHA-58 OEM | soumissions/réponses constructeur et historisation, idempotence et rôles | `oem_status` serveur |
| KHA-59 ADJUDICATION | décision par ligne, partiellement acceptée/refusée, immuable après validation sauf correction auditée | lignes existantes |
| KHA-60 SETTLEMENT | avoir/paiement/rapprochement multi-références, montants et solde | `payment_status`, pas `claim_status` |
| KHA-61/62 | conservation des pièces OEM et tableaux de bord financiers/délais | médias, liens pièces, événements canoniques |

### Contrat minimal avant tout SQL de KHA-53
- **Gate impératif** : corriger et tester les trois chemins React reproduits en section 3.1 (mixed, statut warranty via update générique, accords insurance via update générique) avant de considérer l'approbation des claims comme fiable ; ne pas les masquer en ajoutant simplement des champs OEM.
- Politique d'état explicite (qui peut passer d'un état à un autre), autorité serveur/workshop et RLS testées contre un client non autorisé.
- Migrations **additives** et réversibilité fonctionnelle de lecture ; conserver `repair_claims.status` sans colonne d'état interne doublon ; valeurs par défaut OEM `non soumis` / paiement `non réglé`, jamais `approuvé` sur dossiers anciens sans preuve.
- Liens `(workshop_id,repair_order_id,claim_id)` vérifiés, unicité des références OEM là où approprié, contrôle de version/idempotence.
- Compatibilité PWA v23 et recette React v24 par adaptateurs explicites (y compris statuts `refused/rejected`, `planned/done`, typage du claim), conservation des claims existants, tests de round-trip et de sync ancien client. Harmoniser aussi les rôles React (`directeur-sav`, `chef-atelier`) et DB (`directeur`, `chef_atelier`) avant d'écrire les permissions OEM.
- Enregistrer la décision OEM et son audit dans une même transaction serveur ; traces d'échec/retour constructeur et rôles distincts.
- Aucune activation MEDIA PROD sans ses secrets, consentement/autorisation NIMR, dossier Drive et test réel contrôlé validés séparément.

## 5. Preuves / matrice de vérification KHA-52
- PASS code : `claims.ts`, `sav-case.ts`, `sav-case-store.ts`, `action-permissions.ts`, `workflow-engine.ts` inspectés ; `js/state.js`, `js/ui-cases.js`, `js/supabase-sync.js` inspectés ; Media `supabase/functions/media-drive/index.ts` inspecté.
- PASS catalogue PROD + STAGING : tables/colonnes RLS/FK/triggers consultées en SELECT uniquement. Pas de test DML de permission effectif : ce point reste un gate KHA-53.
- PASS baseline v24 : `claims-domain` 10/10, `claims-planning-blockers` 3/3, `claims-reception-integration` 5/5, `multi-claims-workflow` 6/6 = **24/24**. Revue contradictoire : **3/3 tests isolés de reproduction PASS**, soit 27/27 sur cinq suites ; il s'agit de tests confirmant des lacunes actuelles, **pas de tests de sécurité réussis**. Le fichier temporaire de reproduction n'est pas ajouté au produit.
- GAP confirmé : workflow OEM, statuts OEM/paiement, montants par ligne, preuve de décision serveur et médias warranty en PROD non opérationnels.
- Ce rapport est une cartographie / proposition de migration, pas une implémentation OEM ni une autorisation de déployer.
