# KHA-53 — WARRANTY-CORE-001 / ARCH — Dossier garantie constructeur

**Date :** 30/09/2026 · **Base :** `origin/main 668a2cd91511f96533ac1c470dd3b8f8fa4285e4` · **Nature :** architecture/contrat proposé, non déployé.
**Prérequis :** KHA-52 / `docs/WARRANTY-AUDIT-001-EXISTING-CLAIMS.md` (PR #123 fusionnée).
**Limites explicites :** aucune migration exécutée, ni mutation SQL, ni création de dossiers réels, ni connexion OEM, ni activation Google Drive PROD. Les états et champs proposés ici ne sont pas disponibles dans l'application actuelle.

## 1. Décisions structurantes

1. **Un seul dossier claim.** Étendre conditionnellement `public.repair_claims` pour les claims garantie, identifiés par `type` canonique à documenter/adapter (`garantie` v23 et `warranty` v24). Ne créer ni `warranty_cases`, ni second OR, ni second véhicule, ni second objet opération. Un OR peut avoir plusieurs claims ; **pour une nouvelle soumission OEM**, chaque claim doit être relié à un OR parent canonique, sans supprimer ni réaffecter arbitrairement les claims historiques dont le lien est nul.
2. **Trois axes indépendants.** `repair_claims.status` reste l'état de travail/interne existant (alias en lecture `claim_status` dans une API future, jamais une seconde colonne écrivable). `oem_status` exprime la relation/décision constructeur. `payment_status` exprime la liquidation/rapprochement. `status=approved` ou `claimsOverridden` ne constitue **ni** accord constructeur, **ni** règlement.
3. **Références, pas copies concurrentes.** `repair_claims.repair_order_id → repair_orders.id → vehicles.id / clients.id` fournit identité courante. Le dossier garantie peut enregistrer un instantané sourcé **pour l'historique de soumission** : kilométrage constaté à l'événement, immatriculation/modèle/VIN déclarés sur document OEM, sans écrire en retour dans les tables maîtres. Une divergence bloque ou exige une correction traçable.
4. **États sensibles décidés côté serveur.** Un formulaire n'écrit pas directement `oem_status`, `payment_status`, réponse OEM, accord ni preuve audit. Transition transactionnelle contrôlée, version attendue + clé d'idempotence + journal serveur. Ne pas exposer un RPC « protégé » tout en laissant un UPDATE générique sur ses colonnes.
5. **Extension graduelle par lot.** KHA-53 pose le dossier, les sources, la validation et les rails de gouvernance ; KHA-54 décide de la préautorisation, KHA-55 des lignes MO/pièces et montants, KHA-56 des médias, KHA-57/58 de la revue/soumission, KHA-59 des décisions et KHA-60 des règlements. Aucun statut « accepté/payé » factice à la création.

## 2. Cartographie des données et autorité

| Exigence | Source canonique / proposition | Règle KHA-53 |
|---|---|---|
| Claim, identifiant, OR et atelier | `repair_claims.id, workshop_id, repair_order_id, local_id, number, type` | réutiliser ; vérifier claim↔OR↔atelier ; `repair_order_id` est **nullable aujourd'hui** : aucun nouveau claim OEM prêt à soumettre sans OR vérifié ; claims historiques sans OR à inventorier et traiter sans destruction |
| VIN | `vehicles.vin` via `repair_orders.vehicle_id` | lecture canonique ; `vehicle_id` est **nullable aujourd'hui** : afficher inconnu et bloquer l'étape qui exige un VIN jusqu'à résolution ; vérifier cohérence ; ne pas enregistrer VIN inventé |
| Immatriculation / marque / modèle | `vehicles.registration/brand/model` | lecture canonique ; snapshot lors d'une soumission si exigé, provenance et date |
| Client propriétaire / contact | `repair_orders.client_id → clients` et liaison véhicule | `client_id` est **nullable aujourd'hui** : lire la source OR si connue, détecter divergence avec `vehicles.client_id`, ne pas fabriquer de relation ni écraser une donnée pour faire passer le contrôle |
| Kilométrage | `vehicles.mileage` courant ; `js/state.js` contient aussi `mileage` / kilométrage réception | enregistrer l'**observation datée** pour la réclamation (valeur numérique non négative, source réception/OR/document, acteur), et ne pas écraser le kilométrage maître pour un historique |
| Date 1re MEC / date de livraison véhicule | champs non trouvés dans les colonnes `vehicles` ou `repair_orders` vérifiées PROD/STAGING | valeurs facultatives et **sourcées** (carnet, ERP/Navision, livraison), ne pas confondre avec `repair_orders.delivery_done_at` qui concerne la restitution atelier ; absence = inconnu |
| Couverture / éligibilité | nouvel ensemble garantie associé au claim : programme/type, début/fin si documentés, limites km, **contrôle préliminaire NIMR** `eligible/ineligible/unknown`, motif, document/source/date/acteur | `unknown` à la création ; ce contrôle local n'est **jamais** une décision d'acceptation constructeur ; pas de calcul ou d'acceptation automatique à partir de l'âge/km ; règles particulières HEV/EV et modèles vérifiées avec conditions constructeur |
| Plainte client | texte **verbatim** dédié au claim, date/source/auteur ; `repair_orders.notes` est contexte seulement | préserver la saisie d'origine, corrections en événements distincts ; pas de paraphrase destructrice |
| Diagnostic / cause | champ structuré + texte source ; `normalizeRepairClaim.diagnosticConclusion` v23 existant en contexte | séparer symptômes, tests, conclusion diagnostic, cause présumée/confirmée ; non renseigné reste non renseigné |
| Pièce causale | référence pièce normalisée + description, code constructeur si connu ; relation future à une ligne pièce canonique | facultatif au brouillon, preuve et origine obligatoires selon règle OEM avant soumission |
| DTC / codes défaut | entrées répétables code calculateur/système, code brut, statut, date de lecture, source outil, commentaire | respecter DTC constructeur, pas de déduction depuis texte libre ; mesures/preuves vers KHA-56 |
| Dates clés | dates d'observation, création, diagnostic, préautorisation, soumission, réponse, correction et paiement | garder `created_at/updated_at` existants ; les événements serveur portent dates d'action ; ne pas utiliser dates fournies par navigateur comme décision OEM |
| Références constructeur | type, référence OEM externe, constructeur, document source, validité, horodatage/acteur | références non vides seulement si reçues/documentées ; unicité à définir par constructeur + atelier + type selon règles validées ; ne pas inventer format universel |
| Opérations / MO / pièces / compléments | `repair_claim_labor_lines`, `repair_steps`, `repair_supplements`, sources pièces existantes à cartographier KHA-55 | lier par identifiants, **ne pas** créer opérations et montants en double dans KHA-53 |
| Média / preuves | `photos`, MEDIA-DRIVE (KHA-46..51), STAGING `claim_id` ; PROD pas encore MEDIA additive | KHA-56 rattache les preuves existantes ; ne pas mettre Base64, clés Drive ou nouvelles tables de fichiers dans claim |

**Principe de provenance :** toute valeur saisie manuellement utilisée pour une décision OEM porte source, auteur, instant d'observation/validation, version et correction append-only. Un snapshot est une preuve historique, pas une deuxième source de vérité modifiable du VIN, de l'OR ou du véhicule.
## 3. Contrat de données logique / stockage envisagé (à designer puis migrer)

### 3.1 Extension additive de `repair_claims`

| Groupe | Forme logique proposée | Comportement |
|---|---|---|
| identification constructeur | `oem_manufacturer`, `oem_reference` (si disponible), `oem_program` | lié au claim existant ; exigence et unicité évaluées par marque/type |
| état | `status` (existant), `oem_status` (nouveau), `payment_status` (nouveau) | aucune colonne `claim_status` indépendante ; valeurs initiales OEM `not_submitted`, paiement `not_settled` **uniquement comme absence de règlement documenté, pas comme créance exigible** |
| détails cœur | plainte verbatim, diagnostic, causal-part et couverture/éligibilité structurés ; les noms finaux doivent être fixés au BUILD | champs optionnels au brouillon, validation progressive selon passage d'état, pas de JSON libre utilisé pour contourner les rôles |
| snapshot sourcé | `case_context_snapshot` versionné (ou relation spécialisée à décider pendant build) | capture à événement métier, avec champ source/date/acteur et référence OR/vehicle ; aucune écriture en retour aux entités canoniques |
| concurrence | `version` existante + expected_version + idempotency key de transition | refus au conflit, mêmes paramètres rejoués = même résultat, clé réutilisée avec payload différent = conflit |
| piste d'audit | `audit_logs` existant + mécanisme serveur OEM sous transaction | écriture client `client_asserted` ne prouve pas une réponse OEM |

**Ne pas figer du DDL ici :** types SQL exacts, contraintes `CHECK`, états, noms colonnes et politiques sont à reviewer dans une migration versionnée **non destructive** et testée en STAGING. Aucun objet runtime/SQL n'est créé par ce document.

### 3.2 Trois automates et invariants

| Axe | Valeur initiale sur une nouvelle garantie | Transitions réservées aux lots suivants |
|---|---|---|
| Interne — `repair_claims.status` | `draft` ; préservation intacte des valeurs historiques `draft/expert_pending/client_pending/approved/refused/planned/done` sur v23 | le suivi planning/atelier garde son autorité existante et ses contrôles, sans traduire implicitement `approved` en OEM-accepted |
| Constructeur — `oem_status` | `not_submitted` | préautorisation/soumission/complément/réponse, accepté/partiel/refusé selon KHA-54/58/59 ; une réponse externe demande référence et preuve |
| Financier — `payment_status` | `not_settled` (aucune preuve de règlement, **aucune créance présumée** ; nom final à confirmer KHA-60) | facturé/avoir attendu/partiellement réglé/réglé/litige selon KHA-60 et rapprochement réel ; exclure `not_submitted`/non accepté des KPI « en attente de paiement » ; hors garantie = NULL/`not_applicable` à décider sans backfill trompeur |

Pour les anciens claims, ajout SQL **nullable / valeur initiale calculée selon le type** et migration de backfill prudente : ne jamais inférer une acceptation OEM à partir de `status=approved` ; préserver et journaliser l'origine. Définir au build si les statuts OEM/financiers restent NULL hors garantie ou sont des valeurs `not_applicable` explicites ; éviter le mélange des claims assurance et constructeur. Les colonnes `repair_claims.repair_order_id`, `repair_orders.vehicle_id` et `repair_orders.client_id` sont aujourd'hui **NULLABLE dans PROD et STAGING**. Inventorier les cas historiques par agrégats autorisés en STAGING, conserver leur lecture et empêcher leur soumission OEM tant que les liens canoniques ne sont pas résolus ; ne pas poser `NOT NULL` global sans réconciliation et plan de retour.

**Compatibilité stricte v23↔v24 :** `type=assurance` ↔ `claimType=insurance`, `type=garantie` ↔ `warranty` sous table documentée ; `refused` ↔ `rejected` uniquement avec traduction contrôlée et sans perdre motif ; `planned/done` v23 ne sont pas dans l'union `Claim.status` React v24 : préserver comme statuts hérités ou refuser le round-trip destructeur. `mixed` n'est pas autorisé à contourner `getBlockingClaimsReasons`. Le pipeline de synchronisation v23 `js/supabase-sync.js` ne doit **jamais** effacer les colonnes OEM avec des valeurs absentes dans ses projections.

### 3.3 Règles de validation progressive

- **Création brouillon KHA-53 liée à un OR** : atelier membre autorisé, OR présent dans le même atelier, `type` explicitement `garantie` selon le mapping validé, ID stable ; ne pas accepter les valeurs par défaut DB (`repair_claims.type='assurance'`, `workshop_id` atelier fixe) comme identité ou classification de garantie. Les champs OEM inconnus restent absents, aucun faux accord/décision/paiement. Le cas d'une **préautorisation avant ouverture d'OR** doit faire l'objet d'une décision contractuelle KHA-54 distincte, sans OR fictif ni perte des données lors de la conversion en claim.
- **Complet pour revue garantie** : OR↔vehicle↔client résolus, VIN cohérent, observation du kilométrage, plainte verbatim, diagnostic/cause et pièce causale selon exigence constructeur, éligibilité sourcée, DTC si applicable ; chaque manque est expliqué, pas remplacé par une valeur fictive. Vérifier l'atelier des références et le statut soft-delete des entités, y compris lorsqu'une ancienne FK est physiquement encore valide.
- **Soumission/préautorisation** : contrôles supplémentaires KHA-54/57/58 ; présence des lignes et preuves exigées et de la version de règles utilisée ; snapshot gelé.
- **Après soumission** : mutation du contenu sensible uniquement par événement amend/cancel/reopen autorisé et audité ; gel média/lignes/liaisons avec correction explicite, pas effacement silencieux.
- **Décision constructeur et paiement** : acteurs autorisés, preuve externe et transaction serveur séparées ; jamais dérivés d'un simple accord client, d'un override planning ou d'un statut interne.
## 4. Permissions et sécurité — architecture obligatoire

### 4.1 Domaines et rôles

Les noms UI React (`directeur-sav`, `chef-atelier`) et DB (`directeur`, `chef_atelier`) doivent être mappés via le registre de rôles canonique, **pas** via du texte libre fourni par le navigateur.

| Action métier | Réception | Chef Atelier / diagnostic | Garantie habilitée* | Direction / Admin technique | Lecture/Technicien |
|---|---|---|---|---|---|
| Lire claim de son atelier | oui selon confidentialité | oui selon nécessité | oui | oui | lecture ciblée seulement |
| Créer/enrichir un brouillon sans statut sensible | rôle désigné, à préciser au BUILD | diagnostic seulement | oui | oui | non |
| Attester accord client / expert | flux spécialisé avec preuve et identité vérifiée | non | selon délégation | selon délégation | non |
| Décider éligibilité OEM / soumettre | non | proposition technique seulement | oui, après habilitation côté serveur | selon délégation écrite | non |
| Enregistrer décision OEM | non | non | oui, sur preuve constructeur authentifiée | selon délégation | non |
| Enregistrer règlement / rapprochement | non | non | seulement si habilitation financière distincte | rôle Finance autorisé défini pour KHA-60 | non |
| Bypass atelier (existant) | selon droits actuels, hors OEM | hors OEM | hors OEM | admin existant / motif audité | non |

*Le rôle « Garantie habilitée » est une **capacité future à provisionner**, pas un rôle actuel déjà déployé. Son attribution et sa gouvernance doivent être décidées avec NIMR avant d'écrire la politique SQL. Pas d'attribution automatique à Réception ou Directeur.

### 4.2 Risques existants que KHA-53 BUILD doit fermer **avant** d'ouvrir l'OEM

1. Reproduction KHA-52 : `mixed/draft` ne bloque pas `getBlockingClaimsReasons` alors que `isClaimApprovedForPlanning` le refuse ; harmoniser règle globale + tests planification.
2. `savCaseStore.updateClaim` accepte `Partial<Claim>` : un Chef Atelier peut mettre `warranty.status='approved'`, ou `insurance.expertApproved/clientApproved=true` par mutation générique. Introduire liste blanche des champs non sensibles et actions spécialisées non contournables. Tester côté store, API et DB (pas seulement UI).
3. RLS actuelle autorise des INSERT/UPDATE génériques des claims aux rôles Réception/Chef/Direction/Admin du workshop ; le rôle Postgres `authenticated` dispose aujourd'hui de privilèges **INSERT et UPDATE au niveau de la table** sur `repair_claims` (catalogue STAGING). **Ni un RPC seul ni une policy RLS limitée aux lignes ne protègent de l'injection de `oem_status`/`payment_status` dès INSERT, UPDATE ou UPSERT**. Choisir une frontière sûre : révoquer les privilèges table-level trop larges puis autoriser uniquement les colonnes legacy sûres, et/ou garde métier côté serveur pour toutes les mutations directes ; conserver les usages v23 après tests de régression. Refuser aussi la modification de `type` vers `garantie` et des liens OR/workshop par une requête directe non autorisée. Tester le cas de valeurs frauduleuses à la création, pas seulement l'édition.
4. FK existantes sur claim/OR/media non composites `workshop_id` : tester liaisons inter-ateliers avec fixtures **STAGING uniquement**, puis imposer une invariant atelier commun pour claim, OR, lignes et preuves ; trigger `nimr_keep_workshop_scope` seul ne vérifie pas la cible.
5. FK constatées : `repair_claim_labor_lines.claim_id ON DELETE CASCADE`, `repair_supplements.claim_id ON DELETE SET NULL`, et `photos.claim_id ON DELETE SET NULL` STAGING. Après soumission, interdiction de suppression physique/détachement orphelin ; amendements et conservation auditée, vérifier également la suppression de l'OR parent. **La clôture atelier ne clôture pas le suivi OEM** : réclamation, réponse ou règlement peuvent se poursuivre après restitution. Le code MEDIA actuel refuse les nouvelles écritures dès `closed_at/archived_at` ; KHA-56/61 doivent concevoir un ajout de preuve complémentaire strictement borné, append-only et audité, sans rouvrir l'OR ni éditer/supprimer les médias gelés.
6. `audit_logs` client : `nimr_stamp_client_audit_log` force l'acteur et `client_asserted`, mais ses données métier sont déclaratives. Faire évoluer le chemin décision OEM pour **audit transactionnel serveur**, preuve de provenance, acteur/session authentifiés, horodatage fiable. Un `SECURITY DEFINER` éventuel nécessite `search_path` borné, `EXECUTE` révoqué à PUBLIC/anon, contrôles `auth.uid()`/workshop/role internes et tests.
7. Concurrence : changement OEM avec expected_version, idempotency key, verrou de ligne/contrôle de version, audit dans la même transaction ; tests rejoués/concurrents avec deux ateliers et deux utilisateurs.
8. Pièces et secrets : aucun `service_role` dans le navigateur, aucun binaire ou jeton Drive en clair dans les claims ; identité des documents par références contrôlées, média KHA-56 derrière son gate.

Référence de doctrine technique : [guide Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) et skill Supabase installé. Les permissions futures ci-dessus sont **proposées** et soumises à validation NIMR ; les permissions actuelles du socle restent celles relevées par KHA-52.

## 5. Ordre d'implémentation, migration contrôlée et gates

### 5.1 Séquence proposée

| Étape | Livraison / preuve exigée | Gate |
|---|---|---|
| A — Harden fondation | corrections des 3 chemins React KHA-52, tests négatifs réels `mixed`, approve via update générique, dérive de rôle ; cartographie PWA v23↔v24 statuts et types | PASS avant toute nouvelle action OEM |
| B — DB additive STAGING | migration versionnée, colonnes OEM/paiement + modèle détails/snapshots choisi, validations + FKs workshop, restriction mutation directe et rollback/compatibilité de lecture | review SQL + advisors + migration seulement STAGING avec compte autorisé |
| C — Autorité serveur | création/enrichissement du brouillon garantie via flux de mutation contrôlé ; transitions sensibles fail-closed ; idempotence/version/audit transactionnel | tests rôle/workshop et deux clients concurrents, sans service_role navigateur |
| D — Adaptateurs produit | PWA v23 lit/écrit ses champs historiques sans toucher OEM ; React v24 conserve valeurs héritées ; Vue « dossier garantie » via `repair_claims`, sans second store | tests données anciennes, round-trip, import/export, responsive et a11y |
| E — Frontière avec lots suivants | contrats KHA-54 PREAUTH (conversion idempotente en claim sans ressaisie), KHA-55 lignes, KHA-56 médias post-clôture contrôlés, KHA-57 revue, KHA-58/59 OEM, KHA-60 règlement | aucun flux fictif de soumission, acceptation ni paiement déclaré opérationnel ; autoriser le suivi OEM après la remise physique sans réouvrir les travaux |

**Rollout :** PR fonctionnelle après ARCH REVIEW → CI/tests → migration SQL en STAGING avec matrice d'accès → recette et vérification versions de clients → approbation explicite pour PROD, sauvegarde/plan de retour, fenêtre et contrôle après activation. L'ARCH ne déclenche aucune étape de rollout.

### 5.2 Matrice de tests minimaux pour KHA-53 BUILD

- **Nouveau claim :** plusieurs claims par OR, `type` garantie et `workshop_id` explicitement validés côté serveur (jamais les défauts SQL), VIN et identité par relations existantes ; champs inconnus affichés comme inconnus, aucune fausse éligibilité. Cas historiques avec OR/vehicle/client NULL lisibles mais non soumissibles sans résolution vérifiée.
- **Mapping :** `garantie/warranty`, `assurance/insurance`, `refused/rejected`, `planned/done`, `mixed` ; aucun écrasement par normalisation ni sync client historique.
- **Validation :** absence VIN / km sourcé / DTC obligatoire / référence pièce / couverture inconnue bloque seulement l'étape concernée avec message explicite ; aucune supposition de garantie automatiquement couverte.
- **Droits :** acteur non habilité ne peut créer la décision OEM/financière ni changer les booléens d'accord via `updateClaim` / `INSERT` / `UPDATE` / `UPSERT` SQL direct / API ; read-only et technicien restent non mutateurs. Vérifier le `GRANT` SQL effectif, pas la seule matrice UI/RLS.
- **Atelier :** fixtures inter-workshop empêchées pour claim↔OR, lignes↔claim, photo↔claim ; falsifier un workshop_id dans le payload est refusé.
- **Conservation :** refus de supprimer/détacher claim, lignes, suppléments, médias après soumission ; correction auditable ; preuves immuables ou versionnées. Tester la continuité OEM après OR clôturé et l'ajout exceptionnel **sans suppression/modification de la preuve d'origine** ; le parcours média `scope=warranty` doit vérifier explicitement l'OR/atelier même si `repair_order_id` est actuellement NULL dans la base.
- **Idempotence/concurrence :** replay identique, mismatch clé/payload refusé, version périmée refusée, audit unique en transaction.
- **Régressions :** suites claims préexistantes (KHA-52 : 24/24), workflow planning, PWA runtime/fingerprint, tests média en STAGING et build Vercel ; QA navigateur sur grands écrans + 390 px.

### 5.3 Critères de sortie ARCH (ce document)

1. Une seule autorité claim et un seul `status` interne ; états OEM/financier séparés.
2. Chaque exigence métier KHA-53 affectée à une donnée canonique ou une extension sourcée, sans recréer voiture/OR/opération.
3. Les trois lacunes KHA-52 explicitement bloquantes avant BUILD et non présentées comme corrigées.
4. Politique d'habilitation, RLS, gardes, provenance, gel, version/idempotence et tests réels définis.
5. Séquence additive STAGING → revue → PROD explicite ; aucune migration/procédure fictive présentée comme réalisée.

### 5.4 Vérifications réalisées pour l'ARCH

- KHA-53 et dépendances KHA-54/55/56 lus dans Linear.
- Sources consultées sur `main 668a2cd` : `js/state.js`, `apps/nimr-sav-react/src/domain/sav-case.ts` et `claims.ts`, `sav-case-store.ts`, `action-permissions.ts`, `js/supabase-sync.js`, rapport KHA-52 et migration initiale.
- Métadonnées de `vehicles/clients/repair_orders/repair_claims/repair_claim_labor_lines/photos/audit_logs` consultées sur les projets PROD et STAGING **en SELECT catalogue uniquement**, sans interrogation des dossiers clients.
- Les anciennes preuves KHA-52 de 24/24 tests baseline et 3/3 reproductions restent des résultats d'audit historique. À revérifier au BUILD ; **aucun test de fonctionnalité OEM nouvellement implémentée n'est revendiqué ici**.
- Vérification pendant **ARCH REVIEW** : `npm ci` PASS ; `npm run build` (TypeScript/Vite) PASS ; 4 suites claims = **24/24 PASS** ; `npm audit --omit=dev` = **0 avis** à la date du contrôle. `npm ci` signale parallèlement **8 avis sur l'arbre complet** (3 modérés, 5 élevés) à suivre comme dette de dépendances de développement, sans modification de paquet dans cette PR documentaire.

## 6. Revue contradictoire ARCH — précisions intégrées le 30/09/2026

### 6.1 Constats additionnels vérifiés

| Constat de revue | Impact sur la spécification | Décision / gate de BUILD |
|---|---|---|
| `repair_claims.repair_order_id`, `repair_orders.vehicle_id` et `repair_orders.client_id` sont NULLABLE dans les deux catalogues | l'exigence d'une relation OR/véhicule/client valide ne peut pas devenir un `NOT NULL` global sans analyser les anciens enregistrements | création/soumission OEM fail-closed ; dossiers historiques incomplets restent lisibles et sont régularisés sans suppression ni liaison inventée |
| `repair_claims.type` vaut `assurance` et `workshop_id` a un identifiant d'atelier par défaut dans les schémas inspectés | omettre le type ou l'atelier au moment du INSERT peut classer/affecter à tort un dossier | fixer explicitement type/atelier via l'acteur serveur et vérifier son appartenance réelle ; rejeter les valeurs implicites non justifiées |
| `authenticated` possède des GRANT de table INSERT/UPDATE sur `repair_claims` en STAGING, avec RLS au niveau des lignes | ajouter des colonnes protégées puis un RPC ne neutralise ni INSERT avec état forgé ni UPDATE/UPSERT direct | migration de privilèges/guards testée en STAGING et non-régression de la synchronisation legacy, en incluant CREATE et UPSERT |
| `scope=warranty` dans `supabase/functions/media-drive/index.ts` vérifie actuellement le cycle de vie de l'OR lorsqu'un ID OR est disponible et refuse l'écriture pour un OR fermé | création de dossier sans lien OR canonique à durcir ; preuves supplémentaires nécessaires pendant le suivi OEM post-restitution | KHA-56 : lien OR obligatoire pour tout claim soumis ; exception post-clôture à privilège limité, append-only, avec identité/audit et conservation de la preuve originale |
| `vehicles` et `repair_orders` ne portent pas de dates constructeur MEC/livraison véhicule canoniques vérifiées | ne pas assimiler restitution atelier à date de livraison initiale constructeur | absence = inconnue ; recueillir provenance externe vérifiée, sans écraser les données maîtres |
| le contrôle de couverture local peut constater une admissibilité préliminaire | admissibilité NIMR ne signifie pas acceptation OEM ; `not_settled` n'est pas une facture exigible | décision OEM sur preuve externe distincte, KPI règlements exclusifs des états réellement exigibles |

**Limites de la preuve :** les observations SQL ci-dessus proviennent de SELECT sur les métadonnées des schémas PROD/STAGING ; aucun compte malveillant, scénario inter-workshop ou DML métier n'a été exécuté. Les trois cas React KHA-52 restent des reproductions locales à corriger au BUILD, et non une démonstration d'accès distant ou une résolution acquise.

### 6.2 Décisions fonctionnelles à figer avant les transitions suivantes

- **Préautorisation avant OR (KHA-54) :** définir explicitement avec NIMR si une demande peut précéder l'ouverture d'OR. Ne pas créer un OR fictif. Si elle précède l'OR, prévoir un état de demande préparatoire distinct du claim soumis et une **conversion idempotente** vers le même dossier claim canonique, sans nouvelle saisie ni double ligne. L'OR doit être vérifié avant soumission/liaison OEM finale ; aucun contournement implicite par le `repair_order_id` NULL historique.
- **États contractuels :** le `claim_status` demandé par Linear est l'exposition sémantique de `repair_claims.status` (alias API/DTO dérivé), **pas** une seconde colonne mutable. Les libellés et transitions exactes de `oem_status` et `payment_status` doivent être validés avec Garantie et Finance avant DDL. `not_settled` à la création ne doit jamais être ajouté à une créance réelle « à encaisser ».
- **Portée temporelle :** la clôture/restitution de l'OR ne ferme pas le dossier OEM ; soumission, décision, demande de pièces et paiement peuvent continuer après l'atelier. Les preuves déjà gelées restent immuables ; tout ajout post-clôture exige un chemin d'exception documenté par KHA-56/61.
- **Gel de snapshot et correction :** snapshot d'envoi horodaté et sourcé, non réécrit ; correction et amendement par **nouvel événement** avec auteur, motif, version, document OEM si applicable et liaison à la version précédente, pas par remplacement silencieux du JSON.
- **Défauts sûrs :** aucun claim ancien `status=approved`, `planned` ou `done` ne devient `oem_status=accepted` par backfill ; aucune autorisation de travaux ne découle automatiquement de la future acceptation financière constructeur. Conserver `refused/rejected` et états hérités sans conversion destructive.

### 6.3 Conditions de passage au BUILD

L'architecture est utilisable comme **contrat de préparation**. Le futur BUILD ne pourra être déclaré prêt pour déploiement qu'avec preuves reproductibles : corrections des 3 lacunes KHA-52, autorité INSERT/UPDATE/UPSERT et rôles effectifs, liaisons workshop cohérentes, invariants de suppression/soft-delete, mapping legacy, transitions transactionnelles et idempotentes, scénario OR déjà clôturé, revue du modèle de préautorisation, tests négatifs STAGING et validation du périmètre NIMR. L'ARCH REVIEW ne vaut ni permission de déployer ni validation d'une décision constructeur réelle.
