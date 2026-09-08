# NIMR-SAV v23.3.37 — Autorisation formelle d'intervention atelier & intégrité de révocation

8 septembre 2026. Base : v23.3.36, `4e071a7f2e9c77b962deb977ef8f7cf2ff9a30bf`.

Cette version délivre le renforcement de sécurité WORK-AUTHORIZATION-001 (F03) pour la gestion stricte de l'autorisation des travaux et la garantie d'intégrité en cas de révocation.

## 1. Sécurité et autorisation des travaux (F03)

- Découplage strict entre l'accord commercial (`claim.clientApproved` / aggregate `item.flags.clientApproved`) et l'autorisation formelle d'intervention (`claim.authorizationReference`, `hasWorkAuthorizationEvidence`).
- Vérification formelle d'autorisation par prestation via `hasWorkAuthorizationEvidence(claim)` : exige que la prestation existe, ne soit pas refusée (`claim.status !== "refused"`), porte l'accord client (`claim.clientApproved === true`), et contienne une référence d'autorisation non vide (`claim.authorizationReference.trim().length > 0`).
- Blocage strict de la mise en travaux (`getWorkAuthorizationIssues`) tant qu'au moins une prestation requise ne dispose pas d'une preuve formelle d'autorisation.
- Blocage fail-closed du démarrage des travaux tant que la prestation requise ne dispose pas d'une preuve explicite d'autorisation ; le cockpit opérationnel conserve l'action permettant d'enregistrer l'accord manquant.

## 2. Cycle de vie et intégrité de révocation

- Fonction centralisée `clearWorkAuthorization(claim)` pour révoquer l'autorisation formelle dès la désactivation d'un accord client ou le refus/désaccord d'une prestation.
- Révocation automatique et synchrone de `authorizationReference`, `authorizationAt` et `authorizationBy` lors de la modification des champs de prestation (décochement de `clientApproved` ou `expertApproved`, ou passage en statut `refused`) et lors du décochement workflow (`flags.clientApproved`).
- Protection contre toute réactivation intempestive d'une référence d'ordre de réparation périmée : un re-cochage d'accord commercial impose une nouvelle saisie explicite de référence d'autorisation avant mise en travaux.
- Préservation de la fluidité opérationnelle en cours de travaux : `getNextWorkflowAction()` n'impose pas le re-contrôle de l'accord commercial si les travaux sont déjà engagés (`item.flags.workStarted`).

## 3. Robustesse de la suite de tests et conformité TDD

- Ajout du fichier de régression `tests/work_authorization_001.test.mjs` (4 tests unitaires couvrant l'accord importé non équivalent à l'accord d'intervention, le blocage de l'accord commercial sans référence d'autorisation, le blocage fail-closed du démarrage travaux, et la révocation avec immunité contre la réactivation intempestive).
- Enregistrement du test dans `tests/run-audit-release.mjs`.
- Ajustement réaliste des fixtures dans `tests/technician_flow.test.mjs` (intégration des références d'autorisation d'intervention `OR-TECH-001` / `OR-TECH-002` conformes au standard de production).

## 4. PWA et identité de release

- Version applicative : `v23.3.37`
- Cache Service Worker : `nimr-sav-v23.3.37`
- Schéma d’empreinte : `canonical-lf-v2`
- Empreinte canonique runtime :
  `c0e80e0e4737da96f80850aa29876a28d81737adc52584ea55891d32b27de878`
- Les empreintes scellées historiques jusqu’à `v23.3.36` restent inchangées byte-pour-byte.

## 5. Validation

- `tests/work_authorization_001.test.mjs` : 4/4 PASS
- `tests/pwa_cache_version_contract.test.mjs` : PASS
- `tests/pwa_deploy_asset_version_consistency_cache001.test.mjs` : 49/49 PASS
- `tests/release_fingerprint_portability.test.mjs` : 10/10 PASS
- Suite F03 ciblée (7 suites) : PASS
- `run-audit-release` : 41 tests PASS, 0 FAIL, exécutés via 26 fichiers de tests canoniques.

## 6. Supabase et déploiement

- SUPABASE IMPACT: NONE
- Aucune migration de schéma SQL requise.
- Aucun SQL live exécuté.
- Aucune mutation live Supabase requise.
- Aucun changement dans les Edge Functions.
- Aucun déploiement Supabase ni frontend n'est inclus dans ce commit Git.
