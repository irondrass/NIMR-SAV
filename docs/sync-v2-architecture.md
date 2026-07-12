# NIMR SAV — Architecture Sync V2

## Statut

Document de conception de la synchronisation multiposte V2.

Cette première étape ne modifie pas le comportement de production. Elle fixe les
contrats techniques qui guideront les migrations SQL, l’outbox ciblée, les RPC
métier et les lectures Realtime ciblées.

## Objectifs

La synchronisation V2 doit garantir :

1. Supabase est la source de vérité opérationnelle.
2. Chaque opération métier est petite, explicite et idempotente.
3. Une opération est appliquée une seule fois, même après plusieurs retries.
4. Les versions sont attribuées et contrôlées par le serveur.
5. Deux modifications de domaines indépendants ne créent pas de conflit.
6. Les notes, photos et audits sont append-only.
7. Le planning reste atomique et protégé contre les chevauchements.
8. Le mode hors ligne conserve les données et rejoue les opérations au retour.
9. Realtime recharge uniquement l’entité concernée.
10. `cloud_backups` reste une sauvegarde de secours, jamais le moteur de fusion.

## Architecture actuelle à retirer progressivement

Le moteur V23.3.0 stabilise le snapshot global, mais il reste basé sur :

- un état global `cloud_backups.state` ;
- une outbox `workshop_state / upsert_snapshot` ;
- une comparaison de gros objets JSON ;
- des événements Realtime qui déclenchent un pull global ;
- un polling de secours qui relit le snapshot complet.

Cette architecture reste utile pendant la migration et comme rollback, mais elle
ne doit pas être la cible finale multiposte.

## Source de vérité cible

Les données opérationnelles sont lues et écrites dans les tables métier :

- `repair_orders`
- `repair_steps`
- `repair_claims`
- `repair_claim_labor_lines`
- `repair_supplements`
- `repair_supplement_lines`
- `planning_slots`
- `planning_resources`
- `photos`
- `audit_logs`
- `app_settings`

`cloud_backups` est conservé pour :

- sauvegarde périodique ;
- restauration administrateur ;
- rollback de migration ;
- export de secours.

Il ne participe plus aux décisions ordinaires de convergence entre postes.

## Enveloppe d’opération Sync V2

Chaque modification locale produit une opération ciblée :

```json
{
  "schemaVersion": 1,
  "operationId": "uuid",
  "idempotencyKey": "atelier|domaine|entité|action|uuid",
  "workshopId": "uuid",
  "deviceId": "poste-stable",
  "userId": "uuid",
  "entityType": "repair_order",
  "entityId": "uuid-ou-local-id",
  "domain": "header",
  "action": "patch",
  "expectedVersion": 12,
  "payload": {
    "changes": {
      "phone": "99706508"
    }
  },
  "createdAt": "date ISO"
}
```

Une opération Sync V2 ne doit jamais transporter l’état complet de l’atelier.

Sont interdits dans le nouveau moteur :

- `entityType = workshop_state`
- `action = upsert_snapshot`
- `payload.state`
- un remplacement global déclenché par une petite modification métier

## Domaines et versions

Un dossier ne doit pas dépendre d’une seule version globale.

| Domaine | Exemple | Version serveur cible |
|---|---|---|
| `header` | client, téléphone, véhicule, OR | `header_version` |
| `estimate` | devis, lignes MO, validation PDF | `estimate_version` |
| `status` | état métier du dossier | `status_version` |
| `execution` | démarrage, pause, fin de tâche | `execution_version` |
| `planning` | créneaux et affectations | `planning_version` |

Les premières migrations concerneront `header`, `status` et `planning`.
Les autres domaines seront activés progressivement.

## Règles de fusion

### Fusion automatique

- deux patches portant sur des champs différents du même domaine ;
- ajout d’une note ;
- ajout d’une photo ;
- ajout d’un audit ;
- ajout d’une tâche avec un identifiant distinct ;
- mises à jour de domaines différents ;
- répétition de la même opération idempotente.

### Conflit manuel

- deux valeurs différentes pour le même champ critique ;
- deux transitions incompatibles du même statut ;
- modification concurrente de la même durée de tâche ;
- changement concurrent du même VIN ou numéro OR ;
- réservation planning refusée par le RPC atomique.

### Règles particulières

- les audits ne sont jamais mis à jour ni supprimés ;
- les notes partagées sont de nouvelles lignes, pas un grand texte remplacé ;
- les suppressions métier sont des soft deletes ;
- un ACK serveur est nécessaire avant de retirer une opération de l’outbox.

## Realtime cible

Un événement Realtime doit appeler un lecteur ciblé :

- `repair_orders UPDATE` → recharger le dossier concerné ;
- `repair_steps UPDATE` → recharger la tâche concernée ;
- `planning_slots INSERT/UPDATE/DELETE` → recharger le planning du dossier ;
- `planning_resources UPDATE` → recharger uniquement les ressources ;
- `photos INSERT` → ajouter la métadonnée photo ;
- `audit_logs INSERT` → ajouter l’événement si nécessaire.

Aucun de ces événements ne doit déclencher par défaut un pull de
`cloud_backups.state`.

## Outbox cible

IndexedDB conserve les opérations tant qu’un ACK serveur n’est pas reçu.

États :

- `pending`
- `processing`
- `acknowledged`
- `conflict`
- `failed`

Une opération contient son propre payload métier. Elle ne reconstruit pas un
snapshot global au moment du retry.

## Stratégie de migration

### Phase A — Fondation sans bascule

- document d’architecture ;
- contrat JavaScript pur des opérations ;
- tests d’idempotence, validation et fusion ;
- aucune modification du runtime.

### Phase B — Schéma et RPC serveur

- versions serveur par domaine ;
- RPC ciblés et idempotents ;
- RLS par atelier ;
- journal `sync_operations` conservé ;
- tests SQL.

### Phase C — Shadow mode

- les actions continuent d’utiliser le moteur V23.3.0 ;
- les opérations V2 sont produites et validées en parallèle ;
- aucune opération V2 ne modifie encore l’interface ;
- comparaison des résultats et métriques.

### Phase D — Lecture ciblée

- Realtime ciblé ;
- cache local par entité ;
- snapshot global conservé uniquement comme fallback.

### Phase E — Écriture ciblée

- bascule progressive par domaine ;
- planning en premier car son RPC atomique existe déjà ;
- header et statut ensuite ;
- désactivation de `upsert_snapshot` opérationnel.

### Phase F — Retrait du merge global

- `cloud_backups` devient uniquement sauvegarde/restauration ;
- polling global supprimé ;
- conflits de snapshot supprimés de l’interface active.

## Rollback

Chaque phase doit être réversible :

- feature flag par domaine ;
- aucune suppression immédiate de colonne ou table ;
- sauvegarde avant migration ;
- migrations SQL additives ;
- snapshot V23.3.0 conservé jusqu’à validation complète de Sync V2.

## Critères d’acceptation

Sync V2 sera considéré prêt lorsque :

- 20 postes peuvent modifier des dossiers différents sans conflit ;
- deux postes peuvent modifier des domaines différents du même dossier ;
- un retry réseau n’applique jamais deux fois une opération ;
- aucun refresh navigateur ne crée un conflit ;
- une déconnexion prolongée conserve et rejoue les opérations ;
- un conflit manuel indique l’auteur, la date et les versions serveur ;
- Realtime ne recharge pas l’état complet de l’atelier ;
- `cloud_backups` n’est plus utilisé pour la convergence ordinaire.
