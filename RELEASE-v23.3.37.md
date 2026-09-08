# NIMR-SAV v23.3.37 — Autorisation formelle d'intervention atelier & intégrité de révocation

8 septembre 2026. Base : v23.3.36, `4e071a7f2e9c77b962deb977ef8f7cf2ff9a30bf`.

Cette version délivre le renforcement de sécurité WORK-AUTHORIZATION-001 (F03) pour la gestion stricte de l'autorisation des travaux et la garantie d'intégrité en cas de révocation.

## 1. Sécurité et autorisation des travaux (F03)

- Découplage strict entre l'accord commercial (`claim.clientApproved` / aggregate `item.flags.clientApproved`) et l'autorisation formelle d'intervention (`claim.authorizationReference`, `hasWorkAuthorizationEvidence`).
- Vérification formelle d'autorisation par prestation via `hasWorkAuthorizationEvidence(claim)` : exige que la prestation existe, ne soit pas refusée (`claim.status !== "refused"`), porte l'accord client (`claim.clientApproved === true`), et contienne une référence d'autorisation non vide (`claim.authorizationReference.trim().length > 0`).
- Blocage strict de la mise en travaux (`getWorkAuthorizationIssues`) tant qu'au moins une prestation requise ne dispose pas d'une preuve formelle d'autorisation.
- Neutralisation de l'accès au cockpit opérationnel et aux décisions d'atelier en cas d'absence d'autorisation formelle.

## 2. Cycle de vie et intégrité de révocation

- Fonction atomique `clearWorkAuthorization(claim)` pour révoquer l'autorisation formelle dès la désactivation d'un accord client ou le refus/désaccord d'une prestation.
- Révocation automatique et synchrone de `authorizationReference`, `authorizationAt` et `authorizationBy` lors du décochement de prestation (`toggleCaseClaimClientApproved`), du refus/désaccord expert, et du décochement workflow (`flags.clientApproved`).
- Protection contre toute réactivation intempestive d'une référence d'ordre de réparation périmée : un re-cochage d'accord commercial impose une nouvelle saisie explicite de référence d'autorisation avant mise en travaux.
- Préservation de la fluidité opérationnelle en cours de travaux : `getNextWorkflowAction()` n'impose pas le re-contrôle de l'accord commercial si les travaux sont déjà engagés (`item.flags.workStarted`).

## 3. Robustesse de la suite de tests et conformité TDD

- Ajout du fichier de régression `tests/work_authorization_001.test.mjs` (4 tests unitaires couvrant l'interdiction de démarrage sans preuve formelle, la non-assimilation de l'accord commercial à l'autorisation d'exécution, la révocation synchrone, et la conformité multi-prestations).
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
- `run-audit-release` : 27/27 fichiers de tests PASS, 0 FAIL

## 6. Supabase et déploiement

- SUPABASE IMPACT: NONE
- Aucune migration de schéma SQL requise.
- Aucun SQL live exécuté.
- Aucune mutation live Supabase requise.
- Aucun changement dans les Edge Functions.
- Aucun déploiement Supabase ni frontend n'est inclus dans ce commit Git.
