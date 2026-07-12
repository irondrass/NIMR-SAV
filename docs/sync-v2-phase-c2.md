# Sync V2 — Phase C2 : comparaison serveur en lecture seule

## Objet

C2 compare les projections locales `header` et `status` avec la ligne
normalisée correspondante dans `repair_orders`.

Le résultat est stocké uniquement dans le journal IndexedDB shadow créé par
C1. Aucune valeur locale ou serveur n’est modifiée.

## Sécurité par défaut

Le feature flag est désactivé par défaut :

```text
nimr-sav-sync-v2-shadow-readonly-enabled:v1 = false
```

Quand il est désactivé :

- aucune requête Supabase C2 n’est lancée ;
- aucun timer C2 n’est actif ;
- aucun journal de comparaison n’est créé ;
- le comportement V23.3.0 et C1 reste inchangé.

## Activation locale sur TEST

Dans la console du navigateur :

```js
setSyncV2ShadowReadonlyEnabled(true);
startSyncV2ShadowReadonlyMode();
```

Désactivation :

```js
setSyncV2ShadowReadonlyEnabled(false);
```

L’activation est locale au navigateur.

## Requête autorisée

C2 utilise uniquement un `SELECT` authentifié et ciblé :

```text
table       repair_orders
atelier     workshop_id = atelier configuré
dossier     local_id = entityId
```

Pour un identifiant UUID non trouvé dans `local_id`, une seconde lecture
ciblée par `id` est autorisée.

Colonnes lues :

```text
id, workshop_id, local_id,
estimate_number, next_action, status,
header_version, status_version,
header_updated_at, header_updated_by,
status_updated_at, status_updated_by,
updated_at
```

Aucune lecture globale de `repair_orders` n’est effectuée.

## Comparaisons

Domaine `header` :

- `estimate_number`
- `next_action`
- `header_version`

Domaine `status` :

- `status`
- `status_version`

Verdicts possibles par domaine :

- `match`
- `value_match_version_drift`
- `same_version_mismatch`
- `local_ahead`
- `server_ahead`

Résultats globaux :

- `match`
- `drift`
- `missing`
- `error`
- `skipped`

## Journal local

Les observations C2 utilisent le store IndexedDB C1 :

```text
base   nimr-sav-sync-v2-shadow
store  observations
kind   server_comparison
```

Chaque observation indique explicitement :

```json
{
  "shadowOnly": true,
  "readOnlySelectAttempted": true,
  "writeAttempted": false,
  "rpcAttempted": false,
  "outboxAttempted": false,
  "globalPullAttempted": false
}
```

Statut courant :

```js
NIMR_SYNC_V2_SHADOW_READONLY_STATUS
```

Dernières comparaisons :

```js
(
  await loadSyncV2ShadowObservations(100)
).filter((entry) => entry.kind === "server_comparison");
```

## Comparaison manuelle d’un dossier

```js
const runtimeState =
  getSyncV2ShadowReadonlyRuntimeState();

const item = runtimeState.cases.find(
  (candidate) =>
    projectSyncV2ShadowCase(candidate).entityId
);

await compareSyncV2ShadowCaseWithServer(
  item,
  { reason: "manual-c2-test" }
);
```

## Interdictions C2

Le runtime C2 ne doit jamais :

- appeler un RPC ;
- envoyer un `INSERT`, `UPDATE`, `UPSERT` ou `DELETE` ;
- alimenter l’outbox V23.3.0 ;
- écrire dans une table de synchronisation, de conflit ou d’audit ;
- lire ou modifier `cloud_backups` ;
- déclencher `pullLatestSupabaseBackup()` ;
- modifier l’état local ;
- résoudre un conflit ;
- modifier l’interface métier.

Le statut C2 conserve en permanence :

```json
{
  "serverWrites": 0,
  "rpcCalls": 0,
  "legacyOutboxWrites": 0,
  "globalPulls": 0
}
```

## Limites volontaires

- lecture limitée à 25 dossiers par cycle ;
- cycle automatique toutes les 60 secondes uniquement quand le flag est actif ;
- aucune correction automatique ;
- aucune création de conflit serveur ;
- aucune mise à jour de version locale ;
- aucune bascule vers le RPC B1.

L’écriture V2 reste interdite jusqu’à validation complète du shadow mode.
