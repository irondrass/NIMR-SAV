# Hotfix V23.3.1 — persistance des horaires atelier

## Incident

Une modification du calendrier atelier était correctement écrite dans
`state.workHours`, puis remplacée quelques secondes plus tard par une ancienne
sauvegarde `cloud_backups` reçue par le polling Supabase.

Le cas critique était une sauvegarde cloud déjà en cours :

1. le payload ancien était construit ;
2. l’utilisateur modifiait les horaires ;
3. la sauvegarde ancienne se terminait après la modification ;
4. son `updated_at` devenait plus récent que la saisie locale ;
5. le polling réappliquait silencieusement les anciens horaires.

## Correction

Le calendrier possède maintenant une empreinte dédiée conservée dans :

```text
nimr-carrosserie-v1:work-hours-sync:v1
```

Une modification locale mémorise :

- l’empreinte avant modification ;
- l’empreinte locale courante ;
- la date de modification ;
- le statut `pending_local`.

Une version distante égale à l’empreinte de départ est reconnue comme une
ancienne sauvegarde en vol et ne peut plus remplacer la saisie locale.

## Acquittement double

Le statut local n’est marqué comme synchronisé que lorsque la même empreinte a
été confirmée par les deux écritures suivantes :

```text
cloud_backups.state.workHours
app_settings.value.workHours
```

Une seule écriture réussie ne suffit pas.

## Reconnexion et redémarrage

Un calendrier local en attente est renvoyé automatiquement :

- au démarrage de la synchronisation Supabase ;
- lors du retour en ligne du navigateur.

Le marqueur local persiste après rechargement de la page.

## Conflit réel

Quand le calendrier local est en attente et qu’une version cloud différente de
la version de départ est réellement plus récente :

- le calendrier local est conservé ;
- un conflit `work_hours_conflict` est créé ;
- aucun remplacement silencieux n’est effectué.

## Limites du hotfix

Le hotfix ne modifie pas :

- les policies RLS ;
- le schéma SQL ;
- le flux PDF-first ;
- la planification atomique ;
- les données véhicules ;
- les contrats Sync V2 expérimentaux.

`data/vehicles.json` reste exactement `[]`.
