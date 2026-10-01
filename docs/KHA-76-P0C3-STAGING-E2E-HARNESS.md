# KHA-76 — P0c.3 STAGING E2E harness

## Objectif

Tester le cutover P0c.3 depuis le vrai client PWA `v23.3.71` vers Supabase STAGING uniquement.

Le runner :
- injecte la configuration STAGING avant le premier chargement navigateur ;
- refuse explicitement l'URL PROD et toute clé `service_role` / `sb_secret_*` ;
- utilise la fonction PWA `upsertLegacyRepairClaims()` ;
- vérifie qu'un claim legacy sûr passe par le RPC ;
- vérifie que les INSERT / UPDATE / DELETE directs sont refusés ;
- vérifie qu'un forgeage de statut protégé est refusé ;
- ne journalise jamais le mot de passe ni les tokens Auth.

Fichiers :
- `tests/helpers/kha76_p0c3_staging_e2e_runner.mjs`
- `tests/kha76_p0c3_staging_e2e_harness.test.mjs`
- `tests/helpers/cdp_browser_harness.mjs`

## Variables requises

Le runner lit uniquement des variables d'environnement :

```powershell
$env:NIMR_KHA76_STAGING_KEY = "<publishable key>"
$env:NIMR_KHA76_TEST_WORKSHOP_ID = "<uuid atelier test>"
$env:NIMR_KHA76_TEST_EMAIL = "<email compte test>"
$env:NIMR_KHA76_TEST_PASSWORD = "<mot de passe jetable>"
```

Pour un compte déjà créé :

```powershell
$env:NIMR_KHA76_AUTH_MODE = "existing"
$env:NIMR_KHA76_TEST_REPAIR_ORDER_ID = "<uuid OR test>"
node tests/helpers/kha76_p0c3_staging_e2e_runner.mjs
```

Pour créer le compte de test quand Auth le permet :

```powershell
$env:NIMR_KHA76_AUTH_MODE = "signup"
node tests/helpers/kha76_p0c3_staging_e2e_runner.mjs
```

## Sorties contrôlées

- `PASS` : RPC + lecture + refus DML direct + refus forge statut validés.
- `AUTH_BLOCKED` : limite Auth Supabase atteinte ; aucune conclusion E2E.
- `AUTH_CONFIRMATION_REQUIRED` : compte créé mais confirmation email requise.
- `AUTH_INVALID` : credentials de test non valides.
- `FIXTURE_REQUIRED` : membership atelier ou OR test à provisionner en STAGING.
- `CONFIG_MISSING` : variables requises absentes.
- `FAIL` : défaut fonctionnel ou sécurité reproduit.

## Cleanup

Le client ne peut pas supprimer le claim créé : P0c.3 révoque volontairement `DELETE` direct.
En cas de `PASS`, le JSON final contient `cleanup.repairClaimIds` et
`cleanup.repairClaimLocalIds`. Le cleanup doit être exécuté avec l’outil
d’administration STAGING autorisé, puis vérifié à zéro résidu.

PROD reste hors périmètre de ce harness.
