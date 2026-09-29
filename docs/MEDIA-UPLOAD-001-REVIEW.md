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

Migrations locales alignées exactement sur l'historique STAGING :
- `supabase/migrations/20260929220514_media_upload_001_additive_model.sql`
- `supabase/migrations/20260929220555_media_upload_001_fk_indexes.sql`

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

- KHA-48 : 8/8 PASS
- KHA-47 / media-drive : 25/25 PASS
- IDENTITY-001C : 12/12 PASS
- SECUX-001 : 42/42 PASS
- Static startup safety : 7/7 PASS
- Reception UX 001B : 7/7 PASS
- Teamdev RDV : 7/7 PASS
- Supabase sync integrity : PASS
- Supabase security contract : PASS
- syntax checks : PASS
- git diff --check : PASS
## Review KHA-48

Corrections issues de la review :
- reprise Drive idempotente : un fichier déjà terminé est retrouvé par `nimr_local_hash` avant d'ouvrir une nouvelle session ;
- conflit de contenu fail-closed si un même `local_id` pointe vers un MIME ou une taille différents ;
- course concurrente : la finalisation conserve le fichier géré le plus ancien et met les doublons gérés à la corbeille ;
- garantie : si OR + claim sont fournis, le backend vérifie que le claim appartient bien à l'OR ;
- suppression : un média déjà `uploading/uploaded` ou portant un `drive_file_id` ne peut plus être supprimé uniquement en local ;
- historique des migrations du repo réaligné sur les deux migrations réellement enregistrées en STAGING.

Contrôle navigateur réel :
- panneau Médias dossier chargé avec photo + vidéo + statuts + retry ;
- contrôle responsive à 390 × 844 ;
- aucun page error ;
- warnings Teamdev UNAUTHENTICATED attendus pendant le contrôle local sans session réelle.

CI externe :
- le check Vercel GitHub reste rouge ;
- le même échec Vercel existait déjà sur KHA-47 et sur sa base, donc il n'est pas introduit par KHA-48 ;
- le connecteur Vercel disponible dans cette session n'a pas l'autorisation du scope `irondrass-projects` pour lire le build log.

Backend :
- aucune Edge Function `media-drive` n'est déployée sur STAGING ou PROD ;
- cette review ne déploie donc aucun backend Drive et ne modifie aucun secret ;
- activation réelle reste une étape de déploiement/configuration distincte.
