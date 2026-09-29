# MEDIA-DRIVE-001 — Security / Architecture Review

Date : 29/09/2026
Issue : KHA-47
Base Git : origin/main @ 6dd9129bb4d95c4a538840f65efd490a905454b1

## Verdict

**PASS local code/security avec activation production encore bloquée par la configuration OAuth Google réelle.**

Aucun secret réel, dossier Drive réel, déploiement Edge Function ou mutation Supabase n'a été effectué pendant la revue.

## Périmètre revu

- `supabase/functions/media-drive/index.ts`
- `supabase/config.toml`
- `tests/media-drive-001.test.mjs`
- `tests/identity_production_authority_hardening_identity001c.test.mjs`
- `docs/MEDIA-DRIVE-001-PREFLIGHT.md`
- schéma/RLS `public.audit_logs`
- schéma métier OR/VIN/claim
- contrat KHA-46 / MEDIA-ARCH-001
- documentation Google Drive/OAuth et Supabase Auth/Edge Functions

## Corrections issues de la revue

### 1. Audit obligatoire avant Google

Le ticket KHA-47 exige la journalisation des opérations sensibles.

La production possède déjà `public.audit_logs` avec :
- RLS INSERT pour un membre atelier ;
- defaults pour id/timestamps/version ;
- auteur et sync_source disponibles.

Correction :
- chaque action Drive sensible écrit d'abord une ligne `media_drive.<action>` ;
- l'INSERT utilise le client Supabase de l'utilisateur et respecte donc RLS ;
- si l'audit échoue, aucun appel Google n'est effectué ;
- aucune URI resumable, access token, refresh token ou client secret n'est écrite dans l'audit.

### 2. Autorisation par contexte métier

La première version n'avait qu'une liste globale de rôles média.

Correction :
- `reception` : admin_technique, directeur, chef_atelier, reception ;
- `diagnostic` : admin_technique, directeur, chef_atelier, technicien, responsable_garantie_support ;
- `repair` : admin_technique, directeur, chef_atelier, technicien ;
- `qc` : admin_technique, directeur, chef_atelier, controle_qualite ;
- `delivery` : admin_technique, directeur, chef_atelier, reception ;
- `warranty` : admin_technique, directeur, chef_atelier, responsable_garantie_support.

`lecture_seule` reste limité à la lecture des contextes non QC/Warranty dans KHA-47. KHA-50 affinera la matrice et les RLS de façon transverse.

### 3. Limite appProperties Google

Google limite une propriété custom à 124 octets clé + valeur.

Correction :
- ne pas stocker le `local_id` complet dans `appProperties` ;
- calculer `SHA-256(local_id)` ;
- stocker `nimr_local_hash` ;
- la finalisation recalcule le hash et refuse toute divergence.

### 4. Finalisation fail-closed

Correction :
- `finalize_upload` exige désormais `local_id` ;
- vérifie workshop ;
- vérifie parent canonique ;
- vérifie le hash d'idempotence ;
- refuse avant audit/Google si `local_id` manque.

### 5. URI resumable protégée contre cache

La session URI Google est une capacité temporaire servant directement au PUT navigateur.

Correction :
- réponses Edge Function : `Cache-Control: no-store` ;
- `Pragma: no-cache` ;
- la session URI n'est jamais journalisée ni persistée côté backend.

KHA-48 devra également interdire sa persistance dans localStorage, IndexedDB métier ou logs frontend.

### 6. Compatibilité future Shared Drive

Correction :
- recherches de dossiers : `supportsAllDrives=true` ;
- `includeItemsFromAllDrives=true`.

La cible initiale reste My Drive personnel ; cette correction évite de figer inutilement le resolver sur My Drive.

## Décisions maintenues

- OAuth utilisateur offline ;
- scope `drive.file` ;
- refresh token uniquement côté serveur ;
- aucun secret Google dans le navigateur ;
- `verify_jwt=true` ;
- autorité workshop/role Supabase avant Drive ;
- aucun chemin Drive libre fourni par le client ;
- resolver basé sur OR/VIN/claim Supabase ;
- dossiers identifiés via `appProperties`, pas par le nom seul ;
- upload resumable ;
- aucune modification de `public.photos` dans KHA-47 ;
- aucune intégration frontend dans KHA-47.

## Validation

### KHA-47
21/21 PASS.

Couverture notamment :
- auth bearer ;
- workshop/role ;
- context RBAC ;
- bootstrap root admin-only ;
- résolution canonique ;
- concurrence dossier ;
- Warranty ;
- upload resumable ;
- MIME/taille ;
- audit fail-closed ;
- no-store ;
- métadonnées sanitizées ;
- finalize hash/workshop/parent ;
- erreurs OAuth sanitizées ;
- absence de chemin libre.

### Régressions
- IDENTITY-001C : 12/12 PASS ;
- Teamdev RDV : PASS ;
- Réception UX 001B : PASS ;
- SECUX-001 : 42/42 PASS ;
- Supabase Security Contract : PASS ;
- sécurité locale/RGPD : PASS ;
- Static Startup Safety : 7/7 PASS.

## Gates avant production réelle

Avant de déployer/activer KHA-47 :
1. créer/configurer le projet Google Cloud ;
2. activer Google Drive API ;
3. configurer l'écran de consentement OAuth ;
4. créer le client OAuth utilisé par NIMR-SAV ;
5. demander `drive.file` + accès offline ;
6. autoriser le compte Google Pro propriétaire ;
7. obtenir le refresh token sans l'exposer au chat/Git/Linear ;
8. passer le projet OAuth en `In production` avant exploitation longue durée ;
9. stocker client id/secret/refresh token dans les secrets Supabase ;
10. déployer `media-drive` avec `verify_jwt=true` ;
11. exécuter `bootstrap_root` ;
12. stocker le `GOOGLE_DRIVE_ROOT_FOLDER_ID` résultant ;
13. tester capabilities + resolver + upload réel contrôlé.

## Conclusion

KHA-47 est **prêt pour commit local**.

Il n'est pas encore prêt pour activation production car les credentials OAuth Google et la racine réelle n'ont volontairement pas été créés pendant ce lot de build/review.
