# NIMR-SAV v23.3.38 — Résolution d'authentification au démarrage tolérante aux pannes de transport

8 septembre 2026. Base : v23.3.37, `0e41f37ebce842708ac68b9bd5703936cb54f252`.

Cette version délivre le correctif de sécurité et de robustesse OFFLINE-AUTH-001 pour la résolution transport-aware de la session utilisateur au démarrage.

## 1. Contexte & Problème

En atelier ou sur site, un appareil pouvait signaler `navigator.onLine === true` (liaison radio ou Wi-Fi locale active) alors que le transport réseau vers les services cloud Supabase était indisponible (DNS bloqué, coupure WAN, proxy, requêtes fetch interrompues).
Auparavant, toute erreur réseau lors de `checkUserSessionStartup()` était traitée indistinctement comme une absence de session ou un échec d'authentification cloud en ligne (`NO_CLOUD_SESSION` ou `ONLINE_AUTH_CHECK_FAILED`), forçant immédiatement l'affichage de l'écran de premier accès / saisie de mot de passe cloud (`first-access-overlay`), empêchant les techniciens et chefs d'atelier de poursuivre leur travail sur l'appareil avec leur cache local validé.

## 2. Correctif : Résolution transport-aware de la session

- **Classification stricte des erreurs de transport** : Implémentation de `isSupabaseTransportError(error)` dans `js/supabase-client.js`. Sont classées en indisponibilité transport uniquement les erreurs avec code HTTP absent (`undefined`) ou nul (`status === 0`), `AuthRetryableFetchError` avec statut 0/non défini, `TypeError` de fetch réseau, et interruptions de connexion (timeout, abort, network error). Tout code HTTP positif (`status > 0`), y compris 400, 401, 403, 500, 503, est formellement exclu de la classification transport et échoue en mode fail-closed.
- **Résolution structurée d'état de session** : Implémentation de `getSupabaseSessionState()` dans `js/supabase-client.js`. L'appel interroge `getSession()` avec interception des échecs de transport, puis `getUser()` pour confirmer l'identité cloud active sans bascule prématurée.
- **Démarrage fail-closed strict sans fallback de complaisance** : Dans `app.js` (`checkUserSessionStartup`), la présence de `getSupabaseSessionState` est obligatoire en ligne. Si la fonction est manquante, le démarrage est immédiatement rejeté avec le code `AUTH_PROVIDER_UNAVAILABLE` sans tentative de récupération de cache et sans appel à l'ancienne fonction de complaisance `getSupabaseUser`.
- **Reprise locale sécurisée** : En cas de panne de transport (`TRANSPORT_UNAVAILABLE`), la reprise hors ligne n'est autorisée QUE si l'utilisateur local courant dispose d'une identité préalablement validée (`user.authSource === "supabase_membership"`, `user.membershipValidatedAt`, `user.authUserId`) correspondant strictement à l'atelier configuré (`user.membershipWorkshopId === configuredWorkshopId`).
- **Garantie PIN pour les rôles sensibles** : Pour les rôles sensibles (`admin_technique`, `directeur`, `chef_atelier`) ou les profils avec PIN actif, l'écran de déverrouillage par code PIN local (`user-login-overlay`) reste rigoureusement obligatoire même lors d'une reprise après panne de transport, et aucun rendu de l'espace de travail (`render()`) n'est exécuté avant déverrouillage effectif.

## 3. Frontières de sécurité (Fail-Closed Boundaries)

| Situation au démarrage | Comportement runtime | Code retour | Rendu métier |
| :--- | :--- | :--- | :---: |
| Absence réelle de session cloud | Refus de démarrage, overlay cloud affiché | `NO_CLOUD_SESSION` | Bloqué (0) |
| Rejet d'authentification (401/403) | Refus de démarrage, overlay cloud affiché | `AUTH_REJECTED` / `NO_CLOUD_SESSION` | Bloqué (0) |
| Erreur serveur distante (HTTP 500, 503) | Refus de démarrage, fail-closed | `ONLINE_AUTH_CHECK_FAILED` | Bloqué (0) |
| Panne transport sans identité locale validée | Refus de démarrage, overlay cloud affiché | `OFFLINE_IDENTITY_REQUIRED` | Bloqué (0) |
| Panne transport avec discordance d'atelier | Refus de démarrage, fail-closed | `OFFLINE_IDENTITY_REQUIRED` | Bloqué (0) |
| Déconnexion explicite préalable | Aucun utilisateur courant restaurable | `OFFLINE_IDENTITY_REQUIRED` | Bloqué (0) |
| Panne transport avec identité validée atelier | Reprise autorisée (+ PIN si rôle sensible) | `OFFLINE_FALLBACK_TRANSPORT_UNAVAILABLE` | Autorisé (1) après PIN |

## 4. Tests et validation

- `tests/offline_auth_001.test.mjs` : **12/12 PASS**
  - Scénario A : Contrat hors ligne standard conservé (`navigator.onLine=false`)
  - Scénario B : Panne transport structurée avec identité valide -> fallback local
  - Scénario C : Exception transport fetch avec identité valide -> fallback local
  - Scénario D : Rôle sensible avec panne transport -> gate PIN local obligatoire
  - Scénario E : Panne transport sur appareil neuf/sans cache -> fail closed
  - Scénario F : Rejet sémantique (HTTP 401) -> fail closed
  - Scénario G : Rejet d'appartenance serveur -> fail closed
  - Scénario H : Déconnexion explicite -> fail closed sur panne transport
  - Scénario I : Mismatch d'atelier -> fail closed sur panne transport
  - Scénario J : Erreur 503 avec AuthRetryableFetchError -> fail closed
  - Scénario K : Erreur transport au refresh de session -> fallback local sécurisé
  - Scénario L : Absence de `getSupabaseSessionState` -> fail closed (`AUTH_PROVIDER_UNAVAILABLE`)
- `tests/sec_secure_identity_onboarding_sec001.test.mjs` : **10/10 PASS** (avec nouvelle assertion de non-régression)
- `tests/mobile_offline_recovery.test.mjs` : **PASS**
- `tests/mobile_pwa_resume.test.mjs` : **PASS**
- `tests/user_session_startup_v2233c.test.mjs` : **PASS**
- `tests/realtime_authenticated_lifecycle_p0013.test.mjs` : **PASS**
- `tests/pwa_cache_version_contract.test.mjs` : **PASS**
- `tests/pwa_deploy_asset_version_consistency_cache001.test.mjs` : **49/49 PASS**
- `tests/release_fingerprint_portability.test.mjs` : **10/10 PASS**

### Suites historiques non-canoniques (Documentation d'état)
Les trois suites de tests suivantes ne font pas partie du runner canonique de release (`run-audit-release.mjs`) et leurs résultats préexistaient sur `main` avant ce ticket :

tests/identity_secure_provisioning_offboarding_identity001b.test.mjs
- stale historical snapshot expectations
- not introduced by OFFLINE-AUTH-001

tests/identity_production_authority_hardening_identity001c.test.mjs
- stale historical snapshot expectations
- not introduced by OFFLINE-AUTH-001

tests/supabase_session_refresh_v235.test.mjs
- pre-existing baseline failure:
  "role downgrade stops Realtime again"
- same failure reproduced on baseline
  0e41f37ebce842708ac68b9bd5703936cb54f252
- not introduced by OFFLINE-AUTH-001

Ces suites historiques restent inchangées dans ce ticket conformément au principe de modification minimale.

## 5. PWA et identité de release

- Version applicative : `v23.3.38`
- Cache Service Worker : `nimr-sav-v23.3.38`
- Query d'assets runtime : `?v=23.3.38`
- Schéma d'empreinte : `canonical-lf-v2`
- Empreinte canonique runtime :
  `a766b1c90cffe77c824e7914dfdb8deb20a7620d709620ff66a98f2f6ef426a8`
- Toutes les empreintes scellées antérieures (v23.3.21 à v23.3.37) restent intègres et scellées.

## 6. Supabase et déploiement

- **SUPABASE IMPACT: NONE**
- Aucune modification de schéma SQL (`supabase-schema.sql` inchangé).
- Aucune mutation SQL distante ou migration.
- Aucun changement dans les règles RLS ou les Edge Functions.
- Aucun déploiement frontend ou base de données dans ce commit.
