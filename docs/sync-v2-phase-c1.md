# Sync V2 — Phase C1 : shadow mode local

## Objet

C1 charge le contrat Sync V2 dans le navigateur et observe les changements
locaux des dossiers sans envoyer d’opération au serveur.

Le moteur V23.3.0 reste entièrement responsable de la sauvegarde, de l’outbox,
de Supabase et de l’interface.

## Sécurité par défaut

Le feature flag est désactivé par défaut :

```text
nimr-sav-sync-v2-shadow-enabled:v1 = false
```

Quand il est désactivé :

- aucun timer shadow n’est lancé ;
- aucune base IndexedDB shadow n’est ouverte ;
- aucun candidat d’opération n’est produit ;
- le comportement V23.3.0 reste inchangé.

## Activation locale réservée aux tests

Dans la console du navigateur de l’environnement TEST :

```js
setSyncV2ShadowEnabled(true);
startSyncV2ShadowMode();
```

Désactivation immédiate :

```js
setSyncV2ShadowEnabled(false);
```

L’activation reste locale au navigateur. Elle ne modifie ni les réglages
Supabase ni les autres postes.

## Fonctionnement

`app.js` transmet au runtime une fonction `() => state` après l’hydratation.
Cette fonction lit toujours le binding lexical courant, y compris après un
remplacement complet de l’état local ou cloud. Le runtime n’utilise jamais
`window.state`, car une variable globale déclarée avec `let` n’est pas une
propriété de `window`.

Une fois activé, C1 :

1. capture une référence des dossiers locaux après l’hydratation ;
2. observe les changements toutes les 1,5 seconde ;
3. projette uniquement les domaines B1 :
   - `header` : `estimate_number`, `next_action`
   - `status` : valeur réellement produite par le moteur V23.3.0
4. construit une enveloppe Sync V2 ;
5. la normalise et la valide avec `js/sync-v2-core.js` ;
6. stocke le résultat dans une base IndexedDB séparée.

Base locale dédiée :

```text
nimr-sav-sync-v2-shadow
```

Store principal :

```text
observations
```

## Interdictions C1

Le runtime shadow ne doit jamais :

- appeler le RPC `nimr_apply_repair_order_patch_v2` ;
- écrire dans `sync_operations` ou `sync_conflicts` ;
- écrire dans l’outbox durable V23.3.0 ;
- lancer un pull ou une sauvegarde Supabase ;
- modifier `cloud_backups` ;
- remplacer l’état global ;
- modifier l’interface utilisateur.

Chaque observation porte explicitement :

```json
{
  "shadowOnly": true,
  "transportAttempted": false
}
```

Le statut global expose toujours :

```json
{
  "transportAttempts": 0,
  "supabaseWrites": 0,
  "legacyOutboxWrites": 0
}
```

## Cache PWA et mode hors ligne

Les deux scripts runtime C1 sont ajoutés à la liste de précache du service
worker :

```text
js/sync-v2-core.js?v=23.3.0
js/sync-v2-shadow.js?v=23.3.0
```

Cela garantit qu'un poste ayant installé cette révision peut redémarrer hors
ligne sans perdre le contrat Sync V2 ni le shadow runtime. Le numéro de version
applicatif reste volontairement `23.3.0` tant que C1 n'est pas une release.

## Diagnostic local

Statut courant :

```js
NIMR_SYNC_V2_SHADOW_STATUS
```

Lire les dernières observations :

```js
await loadSyncV2ShadowObservations(50);
```

Effacer uniquement le journal shadow :

```js
await clearSyncV2ShadowObservations();
```

Cette suppression n’affecte ni les dossiers, ni l’outbox, ni Supabase.

## Limites volontaires de C1

- observation limitée à la session courante ;
- pas de comparaison serveur ;
- pas d’ACK ;
- pas de retry ;
- pas de conflit visible dans l’interface ;
- pas d’écriture V2.

La comparaison avec les lignes Supabase et le mode shadow serveur feront
l’objet d’un lot ultérieur après validation de C1.
