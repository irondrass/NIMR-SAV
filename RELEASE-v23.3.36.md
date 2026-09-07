# NIMR-SAV v23.3.36 — Remédiation audit terrain & robustesse atelier

7 septembre 2026. Base : v23.3.35, `608b26d7bdfbb581be6a6e9b4027fbbcbcc0d8c2`.

Cette version regroupe la remédiation FIELD-AUDIT récupérée depuis le travail Astra, puis revalidée sur une branche propre basée sur `main`.

## 1. Import PDF des devis

- Préservation de la main-d’œuvre détaillée, y compris les opérations de renfort.
- Reconstitution des désignations PDF coupées sur plusieurs lignes.
- Séparation correcte des lignes fourniture / main-d’œuvre jointes.
- Exclusion des petites fournitures et consommables des tâches technicien.
- Conservation des variantes modèle, du numéro OR complet, du numéro client et des immatriculations non tunisiennes.
- Classification des documents de fin des travaux afin d’éviter leur traitement silencieux comme devis ordinaires.
- Protection locale contre la création d’un dossier depuis un PDF lorsque le même numéro OR existe déjà dans `state.cases`, via `orNavNumber` ou `claim.orNumber`.

## 2. Rattachement compte technicien ↔ ressource atelier

L’Edge Function `workshop-user-admin` ajoute l’action canonique :

`link_technician_resource`

Le contrat serveur applique les règles suivantes :

- seuls les rôles canoniques `admin_technique` et `directeur` peuvent administrer ces comptes ;
- le compte cible doit être un membre actif de rôle `technicien` dans le même atelier ;
- la ressource doit être une ressource humaine active du même atelier et ne pas être déjà affectée à un autre compte actif ;
- `expected_resource_id` protège contre une liaison devenue obsolète entre l’affichage et l’enregistrement ;
- la condition sur `resource_id` est répétée au moment de l’UPDATE pour fournir un contrôle CAS atomique ;
- une répétition de la même liaison confirmée est idempotente ;
- la réponse `capabilities` expose `can_link_technician_resource`, les membres et les ressources humaines nécessaires à l’interface.

Le client autorise les actions `capabilities`, `invite_member`, `offboard_member` et `link_technician_resource`.

Cette version n’ajoute pas d’action de déliaison dédiée.

## 3. UX technicien non rattaché

- L’interface Planning permet de rattacher ou changer la ressource d’un compte technicien lorsque la capacité serveur l’autorise.
- La vue technicien signale explicitement une identité sans ressource atelier liée.
- L’état local ne reflète la liaison qu’après confirmation du serveur.

## 4. PWA et identité de release

- Version applicative : `v23.3.36`
- Cache Service Worker : `nimr-sav-v23.3.36`
- Schéma d’empreinte : `canonical-lf-v2`
- Empreinte canonique runtime :
  `6e90dfc5c83614ddf8f47c7ab60b919c5090477fcc860f4983c911ace6075016`
- Les empreintes scellées historiques jusqu’à `v23.3.35` restent inchangées.

## 5. Validation

- `field_audit_import` : 6/6 PASS
- `field_audit_account_link` : 18/18 PASS
- `estimate_regression` : PASS
- `workshop_001b_dependency_dag` : PASS, hard guards et benchmarks inclus
- `run-audit-release` : 36/36 fichiers de tests PASS, 0 FAIL
- Contrat PWA/cache : PASS
- Portabilité fingerprint : 10/10 PASS

## 6. Supabase et déploiement

- Aucune migration de schéma requise.
- Aucun SQL live exécuté.
- Aucune mutation live exécutée.
- L’Edge Function `workshop-user-admin` contient des changements locaux qui nécessitent une autorisation de déploiement séparée.
- Ordre recommandé : Edge Function d’abord, frontend ensuite.

Aucun déploiement Supabase ni frontend n’est inclus dans ce commit Git.