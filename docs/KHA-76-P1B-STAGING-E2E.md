# KHA-76 — P1B STAGING E2E

Date: 2026-10-01

## Résultat

P1B STAGING E2E: **PASS**.

Périmètre strict:
- Supabase STAGING: `NIMR-SAV-QC-PRO-STAGING` (`ijgstcdptyxjzgqlvooc`)
- PROD `mkecnwolvzgxltrasbmr`: explicitement interdit par le runner
- utilisateur Auth, atelier, OR, claims et audit E2E: jetables
- cleanup final: zéro résidu

Le test utilise un vrai utilisateur Supabase Auth et son vrai JWT via PostgREST.
Il ne repose pas uniquement sur une simulation SQL de `auth.uid()`.

## Scénarios validés

- membership `agent_agence` dérivé côté serveur
- auto-attribution d'un membership refusée
- création d'un draft garantie sur OR de la même agence
- replay idempotent renvoie le même claim
- mise à jour diagnostic structurée avec version optimiste
- stale version refusée immédiatement en HTTP 412 / `PT412`
- OR autre agence et OR non affecté refusés
- forge `status`, `agencyId` et `payment_status` refusée
- INSERT / UPDATE / DELETE directs sur `repair_claims` refusés
- audit append-only; mutations directes refusées
- RLS masque claim et audit d'une autre agence
- création directe d'OR refusée
- réaffectation directe de `repair_orders.agency_id` sans effet
- aucune autorité review/OEM/payment/stock introduite
- claim final reste `draft`, hors planning, non approuvé, sans montant

## Défaut découvert et corrigé

Le premier E2E réel a reproduit un timeout sur le conflit de version.
La cause était l'utilisation de SQLSTATE `40001` pour `P1B_VERSION_CONFLICT`.

Dans PostgREST 14, `40001` est interprété comme une erreur transitoire de
sérialisation et déclenche des retries. Les logs STAGING montraient une rafale
de répétitions pour une seule requête.

P1B.1 remplace les trois conflits applicatifs par:

```sql
raise sqlstate 'PT412' using message = 'P1B_VERSION_CONFLICT';
```

Le conflit retourne maintenant HTTP 412 sans boucle de retry.
Après correction, un test stale-version produit un seul log et aucun backend
de retry ne reste actif.
## Artefacts

- `supabase/migrations/20261001211619_kha76_p1b1_version_conflict_http.sql`
- `tests/kha76_p1b1_version_conflict_http.test.mjs`
- `tests/helpers/kha76_p1b_staging_e2e_runner.mjs`

Commande E2E:

```powershell
node tests\helpers\kha76_p1b_staging_e2e_runner.mjs --staging
```

## Régression

- contrats sécurité/P1B: 40/40 PASS
- React: 61 fichiers / 503 tests PASS
- build production: PASS
- lint: PASS
- `git diff --check`: PASS
- cleanup STAGING: zéro workshop, OR, claim, membership ou utilisateur Auth E2E résiduel

## Advisors

Les RPC P1B restent volontairement `SECURITY DEFINER` + `authenticated`;
leur autorité bornée est couverte par les tests E2E ci-dessus.

Point performance non bloquant à traiter séparément:
index couvrant la FK `warranty_agency_claim_events.actor_user_id`.
