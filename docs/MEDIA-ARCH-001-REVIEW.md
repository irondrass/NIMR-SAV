# MEDIA-ARCH-001 — Architecture Review

Date : 29/09/2026
Issue : KHA-46
Base Git : origin/main @ 71d503d54d283a5879328712bc6b25da5abbf7ef

## Verdict

**PASS architectural avec 1 gate infrastructure avant KHA-47.**

Le contrat KHA-46 est cohérent avec le code réel, le schéma Supabase, les RLS observées et la roadmap KHA-47→51 après corrections documentaires.

Aucune migration production ni modification runtime n'est requise pour clôturer l'architecture.

## Sources revues

### GitHub / repo
- `js/photos.js`
- `js/state.js`
- `js/supabase-sync.js`
- `supabase-schema.sql`
- migration `20260827081041_nimr_sav_v23_2_8_full_audit.sql`
- `docs/security-supabase-storage.md`

### Supabase production
Projet : `mkecnwolvzgxltrasbmr`

Vérifiés :
- schéma `public.photos`
- 0 ligne dans `public.photos`
- aucun bucket `storage.buckets`
- RLS `public.photos`
- types de `repair_orders`, `vehicles`, `repair_claims`, `repair_steps`
- rôles réellement présents dans `workshop_members`
- FK et contraintes de `public.photos`

### Google Drive
Vérifiés :
- dossiers Garantie historiques ;
- médias avant/après réparation ;
- kilométrage ;
- immatriculation ;
- châssis ;
- pièce causale ;
- ownership de `Garantie_Medias_Nimr` et de plusieurs racines de projet.

### Linear
- KHA-46
- KHA-47
- KHA-48
- KHA-49
- KHA-50
- KHA-51

## Écarts trouvés et corrections

### 1. vehicle_vin ne doit pas être la clé DB canonique
Constat :
- `repair_orders.vehicle_id` existe ;
- `vehicles.id` est UUID ;
- `vehicles.vin` est text.

Correction :
- utiliser `vehicle_id uuid` comme lien canonique ;
- dériver VIN côté backend ;
- ne pas dupliquer VIN comme autorité.

### 2. claim_id est déterminable
Constat :
- `repair_claims.id` = UUID.

Correction :
- fixer `claim_id uuid`, plus de `text/uuid` ambigu.

### 3. operation_id était ambigu
Constat :
- le runtime utilise plusieurs `taskId/businessTaskId` texte ;
- Supabase possède `repair_steps.id uuid`.

Correction :
- `repair_step_id uuid` = lien canonique persistant ;
- `source_task_id text` = compatibilité runtime/offline.

### 4. Taxonomie initiale entrait en conflit avec le runtime
Constat :
- `PHOTO_CATEGORIES` actuel = `before/during/after/supplement`.

Correction :
- préserver ces valeurs dans la dimension legacy `step_key` ;
- ajouter `business_context` séparé : reception/diagnostic/repair/qc/warranty/delivery ;
- ajouter `evidence_kind` séparé.

### 5. RLS actuelles ne couvrent pas les futurs consommateurs
Constat :
- `controle_qualite` et `responsable_garantie_support` sont des rôles réels ;
- ils ne sont pas dans INSERT/UPDATE photos actuel.

Correction :
- KHA-50 devra créer des droits contextuels QC/Warranty ;
- ne pas élargir globalement les policies.

### 6. Suppression physique actuelle incompatible avec la preuve
Constat :
- DELETE photos autorisé à admin/directeur/chef ;
- FK `repair_order_id` utilise `ON DELETE CASCADE`.

Correction :
- cible = suppression logique/lifecycle backend ;
- KHA-50/51 doit neutraliser hard DELETE et cascade ;
- préférence fail-closed : RESTRICT jusqu'à purge autorisée.

### 7. Dérive Supabase Storage
Constat :
- production : aucun bucket ;
- repo : `supabase-schema.sql` crée encore `repair-photos` ;
- document historique Storage existe.

Correction :
- Google Drive reste l'autorité binaire active ;
- ne pas exécuter aveuglément la section Storage historique ;
- KHA-47 doit documenter/neutraliser cette dérive.

## Autres décisions validées

- conserver `public.photos` pour compatibilité ;
- ne pas créer `media_assets` parallèle ;
- `local_id` reste la clé d'idempotence client ;
- checksum = intégrité/détection doublon, pas contrainte unique globale ;
- IndexedDB reste le buffer offline ;
- `drive_file_id` devient l'identifiant physique final ;
- aucun secret Google dans le navigateur ;
- aucun média historique Drive déplacé automatiquement ;
- documents exclus du modèle `public.photos` KHA-46.

## Risque technique à traiter dans KHA-47

Le transport vidéo n'est pas encore validé.

KHA-47 doit tester le mode de transfert réel et ne doit pas supposer qu'une Edge Function proxy intégralement des fichiers vidéo de toute taille.

À valider :
- taille maximale métier ;
- upload resumable/chunked ;
- reprise ;
- timeout/mémoire ;
- mécanisme de réconciliation après succès Drive / échec DB ;
- aucun OAuth durable exposé au navigateur.

## Gate infrastructure restant

Le Drive historique audité est sous le compte :
`mhadhbikhaled@gmail.com`.

Aucune racine média de production NIMR-SAV unique et explicitement dédiée n'a été identifiée.

Avant activation KHA-47 production, choisir explicitement :
- un compte Google professionnel contrôlé par NIMR ;
- ou un Shared Drive Workspace ;
- ou un autre compte de service métier explicitement approuvé.

La racine sera ensuite référencée côté serveur par son ID, jamais recherchée par son nom.

## Conclusion

KHA-46 peut passer au gate de commit documentaire après validation utilisateur.

Aucun point de l'architecture n'exige de redéfinir KHA-47→51.

Le seul choix encore externe à KHA-46 est le propriétaire/racine Drive production.
