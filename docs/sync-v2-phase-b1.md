# Sync V2 — Phase B1 : fondation SQL non active

## Objet

Cette phase prépare Supabase pour recevoir des opérations métier ciblées sans
modifier le comportement V23.3.0 actuellement utilisé par l’application.

Aucun script du runtime n’est chargé ou modifié par ce lot.

## Contenu

La migration `supabase_v23_4_0_sync_v2_foundation.sql` ajoute :

- une base de version initialisée par DDL, sans `UPDATE` massif des dossiers ;
- des versions par domaine sur `repair_orders` :
  - `header_version`
  - `estimate_version`
  - `status_version`
  - `execution_version`
  - `planning_version` existe déjà ;
- les dates et auteurs serveur de chaque domaine ;
- les champs Sync V2 dans `sync_operations` et `sync_conflicts` ;
- le RPC `nimr_apply_repair_order_patch_v2`.

Le RPC B1 accepte uniquement :

- `workshopId` identique à l’atelier passé au RPC ;
- `entityType = repair_order` ;
- `entityId` égal à l’UUID serveur ou au `local_id` stable du dossier ;
- `domain = header` ou `status` ;
- `action = patch` ;
- aucune propriété `payload.state`.

Il n’est pas encore appelé par le frontend.

## Sécurité

Le RPC :

- requiert une session Supabase authentifiée ;
- vérifie l’appartenance et le rôle dans l’atelier ;
- fixe explicitement son `search_path` ;
- retire les privilèges à `public` et `anon` ;
- accorde uniquement `EXECUTE` à `authenticated` ;
- conserve `audit_logs` en append-only.

## Concurrence et idempotence

Le serveur :

1. contrôle l’atelier et l’identité stable du dossier ;
2. sérialise les retries d’une même clé d’idempotence ;
3. retourne le résultat existant avant tout nouveau contrôle de version ;
4. refuse une même clé avec un payload différent ;
5. verrouille le dossier ;
6. compare la version du domaine ;
7. incrémente la version uniquement côté serveur ;
8. enregistre un conflit avec la version, la date et l’auteur serveur ;
9. acquitte l’opération dans la même transaction.

## Domaines B1

### `header`

Champs autorisés :

- `estimate_number`
- `next_action`

`order_number` reste en lecture seule pendant la coexistence avec V23.3.0 :
le moteur historique dérive encore `repair_orders.local_id` du numéro OR.
Autoriser sa modification avant la migration d’identité pourrait créer un second
dossier lors du prochain upsert legacy.

Les notes partagées ne sont pas modifiées par ce RPC. Elles seront ajoutées dans
un stockage append-only dédié lors d’une phase ultérieure.

### `status`

Champ autorisé :

- `status`

Statuts reconnus :

- `new`
- `appointment_scheduled`
- `expert_approved`
- `client_approved`
- `pdf_chief_validation_pending`
- `pdf_ready_for_planning`
- `received`
- `in_progress`
- `work_completed`
- `quality_approved`
- `delivered`
- `chief_validation_pending` — compatibilité avec le défaut historique du schéma

Cette liste reprend les valeurs réellement persistées par
`buildRepairStatus()` dans le moteur V23.3.0. Elle évite qu’un RPC Sync V2
écrive une taxonomie différente pendant la période de coexistence.

## Ce que cette phase ne fait pas

- aucun remplacement de `cloud_backups` ;
- aucune désactivation du moteur V23.3.0 ;
- aucune outbox V2 dans le navigateur ;
- aucune écoute Realtime ciblée ;
- aucune bascule des écritures de production ;
- aucune suppression de table, colonne ou donnée.

## Ordre de validation

1. ajouter les fichiers sur `feat/sync-v2` ;
2. exécuter les tests statiques ;
3. committer et pousser la migration sans l’exécuter ;
4. relire le diff SQL ;
5. sauvegarder Supabase TEST ;
6. exécuter la migration uniquement sur Supabase TEST ;
7. vérifier les privilèges, versions, ACK et conflits ;
8. ne pas appliquer sur production avant le shadow mode.
