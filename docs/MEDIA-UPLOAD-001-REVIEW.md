# MEDIA-UPLOAD-001 — Build / Review

Date : 29/09/2026
Issue : KHA-48
Base Git : main @ 1ba7c16411a2d0d826ff19f0cc0747d73895894b
Release : v23.3.67

## Verdict

PASS build local + validation staging.

Aucune migration n'a été appliquée en production.
Aucun secret Google réel n'a été ajouté.
Aucun upload Google Drive réel n'a été exécuté.

## Implémentation

- modèle média additif dans `public.photos` ;
- photo + vidéo ;
- états `pending|uploading|uploaded|failed` ;
- contexte métier et type de preuve explicites ;
- caption, checksum, auteur/date upload ;
- liens OR / véhicule / claim / repair step / source task ;
- `drive_file_id` comme autorité physique ;
- compatibilité `local-backup` conservée ;
- upload resumable initié par le backend KHA-47 ;
- PUT direct navigateur vers l'URI temporaire Google ;
- finalisation backend fail-closed ;
- anti-doublon par `workshop_id + local_id` ;
- reprise après succès Drive partiel via `drive_file_id` déjà connu ;
- retry explicite dans la galerie ;
- preview photo/vidéo ;
- aucun chemin Drive libre construit par le frontend.

## Migration staging

Migration locale :
`supabase/migrations/20260929214449_media_upload_001_additive_model.sql`

Projet staging :
`NIMR-SAV-QC-PRO-STAGING` (`ijgstcdptyxjzgqlvooc`)

Validé sur staging :
- 16 nouveaux champs présents ;
- 6 contraintes CHECK validées ;
- unicité Drive par atelier ;
- index queue/checksum ;
- index FK dédiés vehicle/claim/repair_step ;
- aucun warning `unindexed_foreign_keys` après correction.

Advisors restants :
- warning SECURITY DEFINER sur une ancienne RPC QC : préexistant, hors KHA-48 ;
- unused indexes sur staging neuf : informatif ;
- multiple permissive policy sur `security_audit_events` : préexistant, hors KHA-48.

## Tests

- KHA-48 : 7/7 PASS
- KHA-47 : 21/21 PASS
- IDENTITY-001C : 12/12 PASS
- SECUX-001 : 42/42 PASS
- Static startup safety : 7/7 PASS
- Reception UX 001B : 7/7 PASS
- Teamdev RDV : 7/7 PASS
- Supabase sync integrity : PASS
- Supabase security contract : PASS
- syntax checks : PASS
- git diff --check : PASS
