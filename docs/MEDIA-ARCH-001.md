# MEDIA-ARCH-001 — Architecture médias transverse

## 1. Objectif

Créer une seule architecture canonique pour les photos et vidéos NIMR-SAV, réutilisée par Réception, Diagnostic, Réparation, QC, Garantie et Restitution.

Autorités :
- Supabase = métadonnées, droits applicatifs, liens métier, statut d'upload, audit.
- Google Drive = binaire physique final.
- IndexedDB navigateur = cache/offline transitoire uniquement.

Aucun gros binaire métier dans PostgreSQL.

KHA-46 ne crée pas de bucket Supabase Storage. Le dépôt contient une ancienne stratégie `repair-photos`, mais la production auditée ne contient actuellement aucun bucket Storage et l'architecture active retient Google Drive comme autorité binaire.

## 2. État réel vérifié au 29/09/2026

### 2.1 Frontend

`js/photos.js` :
- enregistre aujourd'hui les blobs dans IndexedDB ;
- compresse les images ;
- accepte actuellement JPEG / PNG / WebP ;
- limite une photo à 8 Mo ;
- ne gère pas encore les vidéos ;
- restaure/exporte les blobs locaux.

Les catégories photo actuelles du runtime sont :
- `before`
- `during`
- `after`
- `supplement`

Ces valeurs sont legacy et ne doivent pas être réinterprétées silencieusement comme des contextes métier.

### 2.2 Supabase

`public.photos` existe déjà et constitue le point de compatibilité à conserver.

État vérifié :
- 0 ligne en production au moment de l'audit ;
- RLS activée ;
- aucun bucket Supabase Storage présent ;
- `js/supabase-sync.js` écrit explicitement dans `public.photos` ;
- `storage_bucket/storage_path` sont écrits par le sync mais ne sont pas lus par le runtime actuel.

Schéma actuel principal :
- `id uuid`
- `workshop_id uuid`
- `local_id text`
- `repair_order_id uuid`
- `step_key text`
- `storage_bucket text not null default 'repair-photos'`
- `storage_path text not null`
- `filename text`
- `mime_type text`
- `size_bytes bigint`
- audit/version/deleted_at/sync_source

Contraintes importantes :
- `repair_order_id -> repair_orders(id) ON DELETE CASCADE`
- `workshop_id -> workshops(id)`
- unicité `(workshop_id, local_id)`

### 2.3 RLS actuelle à ne pas confondre avec la cible

Production auditée :
- SELECT : tout membre de l'atelier ;
- INSERT : admin_technique, directeur, chef_atelier, reception, technicien ;
- UPDATE : admin_technique, directeur, chef_atelier, reception ;
- DELETE physique : admin_technique, directeur, chef_atelier.

Écarts connus :
- `controle_qualite` existe comme rôle réel mais n'a pas actuellement INSERT/UPDATE sur `photos` ;
- `responsable_garantie_support` existe comme rôle réel mais n'a pas actuellement INSERT/UPDATE ;
- le DELETE physique client existe encore, contrairement à la cible lifecycle ;
- le SELECT global atelier peut être trop large pour certaines preuves Garantie/QC.

Ces écarts sont explicitement à traiter dans KHA-50.

### 2.4 Modèle métier Supabase lié

- `repair_orders.id` = UUID.
- `repair_orders.vehicle_id` = UUID vers le véhicule.
- `vehicles.id` = UUID ; `vehicles.vin` = text.
- `repair_claims.id` = UUID ; `repair_claims.repair_order_id` = UUID.
- `repair_steps.id` = UUID ; `repair_steps.repair_order_id` = UUID ; `repair_steps.step_key` = text.

Le runtime possède aussi des `taskId/businessTaskId` texte. Ils servent aux tâches/planning et ne doivent pas être confondus avec un identifiant DB d'opération.

### 2.5 Google Drive existant

Des médias SAV/garantie existent déjà :
- défaut avant réparation ;
- défaut après réparation ;
- kilométrage ;
- immatriculation ;
- châssis ;
- pièce causale ;
- documents/carnet.

Le dossier historique inspecté `Garantie_Medias_Nimr` se trouve sous un Drive appartenant au compte connecté `mhadhbikhaled@gmail.com`.

Aucune racine métier de production unique `NIMR-SAV` dédiée aux médias n'a été positivement identifiée pendant l'audit. Les nombreux dossiers `NIMR-SAV-...` retrouvés sont principalement des worktrees/sauvegardes de projet et ne doivent pas être utilisés comme racine média de production.

KHA-46 ne renomme, ne déplace et ne supprime aucun média historique.

## 3. Décisions d'architecture

### 3.1 Table canonique

Conserver `public.photos` comme table canonique de métadonnées afin de préserver le sync actuel.

Le nom historique `photos` reste pour compatibilité même si la table gère à terme photo ET vidéo.

Ne pas créer une table concurrente `media_assets` dans KHA-46.

### 3.2 Liens métier cibles

Liens canoniques :
- `repair_order_id uuid` — existant ;
- `vehicle_id uuid null` — FK vers `vehicles(id)` lorsque le média doit exister avant ou indépendamment d'un OR ;
- `claim_id uuid null` — FK vers `repair_claims(id)` ;
- `repair_step_id uuid null` — FK vers `repair_steps(id)` ;
- `source_task_id text null` — référence transitoire/legacy vers un taskId runtime avant résolution vers `repair_step_id`.

Ne pas utiliser `vehicle_vin` comme clé canonique DB : le VIN doit être dérivé côté serveur depuis `vehicle_id` ou l'OR. Un éventuel snapshot VIN n'est qu'un champ d'audit, jamais l'autorité.

Ne pas utiliser un champ ambigu `operation_id text` : l'opération persistée est représentée par `repair_step_id uuid`, avec `source_task_id` pour la compatibilité runtime/offline.

### 3.3 Champs médias cibles

À ajouter progressivement :
- `vehicle_id uuid null`
- `claim_id uuid null`
- `repair_step_id uuid null`
- `source_task_id text null`
- `media_type text not null default 'photo'`
- `business_context text null`
- `evidence_kind text null`
- `drive_file_id text null`
- `drive_folder_id text null`
- `checksum_sha256 text null`
- `caption text null`
- `upload_status text not null default 'pending'`
- `uploaded_by uuid null`
- `uploaded_at timestamptz null`
- `last_upload_error text null`
- `upload_attempts integer not null default 0`

Valeurs cibles :
- `media_type` : `photo|video`
- `upload_status` : `pending|uploading|uploaded|failed`

Contraintes cibles :
- `uploaded` exige un `drive_file_id` non vide ;
- unicité de `drive_file_id` par atelier lorsqu'il est renseigné ;
- `local_id` reste la clé principale d'idempotence côté client/sync ;
- le checksum sert à détecter les doublons de contenu, mais n'est pas unique globalement.

### 3.4 Compatibilité storage_bucket/storage_path

Les colonnes restent pendant la migration.

Constat : elles ne sont actuellement lues nulle part dans le runtime ; `supabase-sync.js` les écrit seulement.

Cible KHA-47/48 :
- conserver `storage_bucket='local-backup'` pour les projections legacy existantes ;
- utiliser explicitement `storage_bucket='google-drive'` pour les nouveaux médias Drive ;
- rendre `storage_path` nullable ou purement informatif avant de créer des lignes `pending` ;
- ne jamais utiliser `storage_path` comme autorité d'accès au fichier ;
- `drive_file_id` devient l'autorité physique.

Le défaut SQL historique `repair-photos` ne doit plus piloter les nouveaux médias.

## 4. Taxonomie métier

Ne pas écraser les catégories runtime legacy.

### 4.1 Dimension legacy

`step_key` continue à accepter les valeurs existantes issues de `photo.category` :
- before
- during
- after
- supplement

### 4.2 Contexte métier nouveau

`business_context` :
- reception
- diagnostic
- repair
- qc
- warranty
- delivery

### 4.3 Type de preuve nouveau

`evidence_kind` :
- general
- odometer
- registration
- vin
- exterior_damage
- interior
- causal_part
- other

Les documents ne sont pas ajoutés à `public.photos` dans KHA-46. Le dossier Drive `WARRANTY/.../DOCUMENTS` peut être réservé, mais sa gestion applicative reste hors scope de cette architecture photo/vidéo.

## 5. Structure Drive cible

Une racine média de production unique doit être choisie avant KHA-47.

Le backend reçoit son identifiant via configuration serveur, par exemple :

`MEDIA_DRIVE_ROOT_FOLDER_ID`

Il ne doit jamais chercher la racine par son nom.

Structure logique :

```
NIMR-SAV/
  VEHICLES/
    {VIN}/
      {OR}/
        RECEPTION/
        DIAGNOSTIC/
        REPAIR/
        QC/
        DELIVERY/
  WARRANTY/
    {CLAIM}/
      PHOTOS/
      VIDEOS/
      DIAGNOSTIC/
      DOCUMENTS/   # réservé, hors public.photos KHA-46
```

Règles :
- le backend crée/résout les dossiers ;
- les IDs Drive, pas les noms, sont l'autorité ;
- les noms de dossiers sont des libellés de présentation ;
- aucun nom client, téléphone ou email dans les chemins ;
- le backend doit être idempotent et sûr en concurrence pour éviter deux dossiers identiques ;
- aucun partage public automatique ;
- `drive_file_id` est l'identifiant physique durable ;
- `drive_folder_id` est conservé pour résolution rapide/audit.

### Gate obligatoire avant KHA-47

Choisir explicitement le propriétaire de la racine média de production :
- compte Google professionnel/organisationnel contrôlé par NIMR ; ou
- Shared Drive Workspace ; ou
- autre compte explicitement approuvé comme compte de service métier.

Le dossier historique personnel audité ne devient pas automatiquement la racine de production.

## 6. Flux canonique

### 6.1 Capture

1. utilisateur capture/sélectionne photo ou vidéo ;
2. validation MIME/taille selon politique KHA-48 ;
3. génération d'un `local_id` stable ;
4. stockage temporaire IndexedDB ;
5. création/maintien de l'état local `pending`.

### 6.2 Préparation serveur

Avant l'upload final :
1. backend vérifie JWT ;
2. vérifie workshop ;
3. vérifie rôle et objet métier ;
4. résout OR/vehicle/claim/repair_step ;
5. crée ou retrouve de manière idempotente le contexte Drive ;
6. prépare la métadonnée Supabase sans déclarer le média `uploaded`.

### 6.3 Upload/finalisation

1. binaire transféré vers Drive par un mécanisme sécurisé ;
2. backend obtient le `drive_file_id` ;
3. intégrité/checksum validée ;
4. `public.photos` est finalisée ;
5. `upload_status='uploaded'`, `drive_file_id`, `drive_folder_id`, taille/MIME/checksum/auteur/date sont enregistrés.

Aucun état `uploaded` sans `drive_file_id`.

### 6.4 Idempotence et reprise après succès partiel

`local_id` + `workshop_id` reste la clé d'idempotence applicative.

Cas critique : Drive accepte le fichier mais la finalisation Supabase échoue.

KHA-47/48 doit fournir un mécanisme de réconciliation permettant de retrouver le fichier déjà créé et de finaliser la même ligne sans produire un doublon. Le mécanisme exact (métadonnée fournisseur/appProperties ou registre serveur équivalent) doit être validé dans KHA-47.

Le checksum est utilisé pour contrôle d'intégrité et détection de doublon, pas comme identifiant unique global.

### 6.5 Transport vidéo

Ne pas supposer qu'une Edge Function doit proxyfier intégralement toutes les vidéos.

KHA-47 doit valider en conditions réelles :
- taille maximale cible ;
- transport resumable/chunked approprié ;
- timeout/mémoire ;
- reprise réseau ;
- absence de credentials OAuth durables côté navigateur.

La solution retenue doit garder l'autorité et les secrets côté serveur, même si le transfert binaire utilise une session d'upload limitée dans le temps.

## 7. Offline

KHA-49 étend l'IndexedDB actuel en file d'upload persistante.

Exigences :
- pending persistant ;
- retry borné + backoff ;
- reprise automatique réseau ;
- idempotence d'abord par `local_id` ;
- checksum pour intégrité/détection de doublon ;
- progression visible ;
- état failed explicite et relançable ;
- aucune perte silencieuse ;
- aucun doublon Drive après reprise.

IndexedDB est réutilisé ; il n'est pas supprimé.

## 8. Sécurité / RLS

Autorité applicative : Supabase.

### 8.1 Principes cible

- vérification systématique workshop ;
- autorisation selon rôle + contexte métier + objet ;
- aucune credential Drive côté client ;
- contrôle MIME/taille/type côté backend, en plus du contrôle UX ;
- checksum ;
- lecture contrôlée ;
- suppression logique côté client ;
- suppression physique réservée à un workflow backend lifecycle ;
- audit des uploads, lectures sensibles, suppressions et erreurs critiques.

### 8.2 Écarts à corriger dans KHA-50

1. QC :
   `controle_qualite` doit pouvoir agir sur les preuves QC selon une policy contextuelle.

2. Garantie :
   `responsable_garantie_support` doit pouvoir agir sur les preuves Warranty selon une policy contextuelle.

3. SELECT :
   ne pas présumer que tout membre de l'atelier doit lire toutes les preuves Warranty/QC.

4. DELETE :
   supprimer le DELETE physique direct actuellement accordé à admin/directeur/chef pour le remplacer par lifecycle/audit contrôlé.

5. FK cascade :
   `photos.repair_order_id ON DELETE CASCADE` est incompatible avec une conservation forte des preuves.
   KHA-50/KHA-51 doit remplacer cette sémantique par une règle fail-closed, préférentiellement RESTRICT tant que le lifecycle n'a pas explicitement autorisé la purge.

Ne pas simplement ajouter QC/Garantie à toutes les policies globales : les droits doivent dépendre du contexte métier.

## 9. Compatibilité legacy et dérive de schéma

Le sync actuel doit continuer de fonctionner pendant la migration.

Règles :
- garder le nom `public.photos` ;
- garder `local_id` unique par atelier ;
- garder `repair_order_id` ;
- garder `step_key` ;
- garder temporairement `storage_bucket/storage_path` ;
- préserver la lecture des projections `local-backup` ;
- ne pas renommer `photo.category` sans migration explicite.

### Dérive connue dans le dépôt

`supabase-schema.sql` contient encore :
- création du bucket `repair-photos` ;
- policies Storage associées.

`docs/security-supabase-storage.md` décrit cette stratégie historique.

Or la production auditée ne contient aucun bucket et KHA-46 retient Drive comme autorité binaire.

Conséquence :
- ne pas exécuter aveuglément la section Storage de `supabase-schema.sql` dans le cadre média ;
- KHA-47 doit neutraliser/documenter cette dérive sans casser les migrations historiques ;
- le document historique reste une référence conditionnelle si Supabase Storage devait être réévalué un jour, mais n'est pas la cible active KHA-46.

## 10. Frontières des lots

### KHA-46 MEDIA-ARCH-001
- architecture ;
- contrat de données ;
- mapping des autorités ;
- compatibilité legacy ;
- risques/gates.
- aucune migration production requise.

### KHA-47 MEDIA-DRIVE-001
- choix/validation racine Drive de production ;
- credential/service backend serveur ;
- configuration `MEDIA_DRIVE_ROOT_FOLDER_ID` ;
- resolver de dossiers idempotent/concurrent-safe ;
- transport photo/vidéo sécurisé ;
- stratégie de réconciliation Drive/Supabase ;
- préparation non destructive du schéma `public.photos` nécessaire à Drive.

### KHA-48 MEDIA-UPLOAD-001
- UI/API upload photo + vidéo ;
- pending/uploading/uploaded/failed ;
- business_context/evidence_kind ;
- liens OR/vehicle/claim/repair_step ;
- checksum ;
- anti-doublon ;
- erreurs relançables.

### KHA-49 MEDIA-OFFLINE-001
- file persistante IndexedDB ;
- reprise réseau ;
- idempotence ;
- progression utilisateur.

### KHA-50 MEDIA-SEC-001
- RLS contextuelles ;
- matrice rôles ;
- intégrité ;
- audit ;
- lecture/suppression contrôlée ;
- correction du hard DELETE et du FK cascade ;
- protections spécifiques QC/Garantie.

### KHA-51 MEDIA-LIFECYCLE-001
- gel ;
- rétention ;
- purge ;
- réouverture ;
- litige/audit/garantie ;
- règles de purge des caches IndexedDB.

## 11. Non-objectifs KHA-46

- ne pas migrer automatiquement les anciens dossiers Drive Garantie ;
- ne pas désigner automatiquement le Drive personnel audité comme production ;
- ne pas créer de bucket Supabase Storage ;
- ne pas supprimer IndexedDB ;
- ne pas exposer Drive au navigateur ;
- ne pas créer une table média parallèle par module ;
- ne pas gérer les documents dans `public.photos` ;
- ne pas décider la durée de rétention métier ;
- ne pas implémenter KHA-47 à KHA-51.

## 12. Critères d'acceptation architecture

KHA-46 est architecturalement prêt lorsque :

1. une seule table canonique de métadonnées est définie ;
2. une seule autorité binaire est définie ;
3. les identifiants métier utilisent les types DB réels ;
4. la compatibilité du sync existant est préservée ;
5. photo et vidéo partagent le même modèle ;
6. les catégories runtime legacy restent distinguées du contexte métier ;
7. OR/vehicle/claim/repair_step sont modélisés sans ambiguïté ;
8. l'offline a une place explicite ;
9. les secrets Drive restent serveur ;
10. l'idempotence et le cas de succès Drive / échec DB sont couverts architecturalement ;
11. les dossiers historiques Drive ne sont pas détruits ;
12. la dérive `repair-photos` est identifiée ;
13. les gaps RLS QC/Garantie/delete/cascade sont explicitement attribués à KHA-50/51 ;
14. KHA-47→51 peuvent être implémentés sans redéfinir l'architecture.

## 13. Décision encore ouverte avant KHA-47

Une seule décision métier/infrastructure reste volontairement ouverte :

**Quel compte ou Shared Drive doit être propriétaire de la racine média NIMR-SAV de production ?**

Cette décision ne remet pas en cause KHA-46, mais bloque l'activation réelle de KHA-47 en production.
