# MEDIA-DRIVE-001 — Préflight d'implémentation

Date : 29/09/2026
Issue : KHA-47
Base Git : origin/main @ 6dd9129bb4d95c4a538840f65efd490a905454b1

## 1. Décision d'infrastructure

Le compte Google Pro personnel connecté est retenu comme propriétaire initial de la racine média NIMR-SAV.

Cible :
- My Drive du compte propriétaire ;
- racine dédiée `NIMR-SAV-PROD` ;
- architecture transférable plus tard vers un compte/Shared Drive NIMR sans modifier le frontend.

La racine n'est pas créée par le plugin ChatGPT. Elle sera créée par le client OAuth propre à NIMR-SAV afin de rester compatible avec le scope minimal `drive.file`.

## 2. Authentification Google retenue

Comme la cible initiale est un My Drive personnel, KHA-47 utilise OAuth 2.0 utilisateur avec accès offline.

Ne pas utiliser un service account comme propriétaire de fichiers My Drive.

Scope cible :
`https://www.googleapis.com/auth/drive.file`

Objectifs :
- limiter NIMR-SAV aux fichiers/dossiers créés ou explicitement ouverts avec l'application ;
- éviter le scope global `drive` ;
- conserver le refresh token uniquement côté serveur.

## 3. Secrets serveur prévus

Les valeurs ne doivent jamais être commitées ni renvoyées au frontend.

Prévoir :
- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` après bootstrap

Les access tokens sont courts et obtenus côté serveur à partir du refresh token.

## 4. Backend Supabase

Edge Function cible :
`supabase/functions/media-drive/index.ts`

Configuration :
`verify_jwt = true`

Le connecteur reprend les conventions existantes de `teamdev-rdv` :
- méthode POST uniquement hors OPTIONS ;
- JWT Supabase requis ;
- vérification utilisateur ;
- vérification `workshop_members` ;
- vérification rôle/context ;
- erreurs structurées ;
- aucune fuite de secrets ;
- timeouts explicites.

## 5. Actions backend prévues

KHA-47 doit fournir le socle Drive, pas encore toute l'UX KHA-48.

Actions minimales :
- `capabilities` : vérifier configuration + autorité sans révéler de secret ;
- `bootstrap_root` : créer ou retrouver de façon contrôlée la racine créée par l'app ;
- `resolve_folder` : créer/résoudre idempotemment les dossiers métier ;
- `begin_upload` : préparer un upload sécurisé/resumable ;
- `finalize_upload` : valider l'identité Drive et retourner les métadonnées minimales ;
- `read_metadata` : lecture contrôlée des métadonnées d'un fichier créé par l'app.

L'API exacte peut être simplifiée pendant le build si les mêmes invariants sont conservés.

## 6. Structure Drive

```
NIMR-SAV-PROD/
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
      DOCUMENTS/
```

Le backend ne doit jamais accepter un chemin Drive libre envoyé par le navigateur.

Les segments doivent être construits à partir d'identités métier résolues côté serveur.

## 7. Sécurité

- aucun Google client secret / refresh token côté navigateur ;
- aucun token dans les logs ;
- aucun partage public automatique ;
- aucune URL publique permanente ;
- JWT Supabase avant tout accès ;
- contrôle workshop/role avant tout appel Drive ;
- whitelist stricte des actions ;
- tailles/MIME validés côté serveur à KHA-48 ;
- lecture et suppression contrôlées à KHA-50/51.

## 8. Upload vidéo

Ne pas proxyfier aveuglément des vidéos complètes via une Edge Function.

KHA-47 doit privilégier une session d'upload resumable limitée dans le temps :
- autorité OAuth et création de session côté serveur ;
- transfert binaire vers Google sans exposer le refresh token ;
- reprise réseau possible ;
- finalisation/validation côté serveur.

## 9. Idempotence

- les dossiers sont résolus par identité métier + recherche limitée au parent autorisé ;
- aucun search global Drive par nom en runtime ;
- la racine finale est référencée par son ID ;
- le cas Drive OK / Supabase KO doit être réconciliable ;
- KHA-48 gardera `workshop_id + local_id` comme clé d'idempotence applicative.

## 10. État du préflight

Vérifié :
- KHA-47 = In Progress ;
- worktree dédié créé ;
- HEAD = origin/main = `6dd9129` ;
- aucun `NIMR-SAV-PROD` existant trouvé via le Drive connecté ;
- Edge Functions production existantes utilisent `verify_jwt=true` ;
- aucune intégration Google Drive/OAuth existante dans le repo ;
- aucun changement Drive/Supabase effectué pendant le préflight.

## 11. Pré-requis externe avant activation réelle

Créer/configurer un client OAuth Google pour NIMR-SAV :
1. projet Google Cloud ;
2. Google Drive API activée ;
3. OAuth consent screen ;
4. client OAuth adapté au bootstrap ;
5. autorisation offline du compte propriétaire ;
6. stockage des secrets dans Supabase ;
7. passer le projet OAuth Google de `Testing` à `In production` avant l'activation NIMR-SAV : en mode Testing, un refresh token peut expirer après 7 jours ;
8. bootstrap de `NIMR-SAV-PROD` via le connecteur NIMR-SAV.

Aucun secret ne doit être collé dans Git, Linear ou le chat.

## 12. Build local KHA-47

Implémenté localement :
- Edge Function `media-drive` ;
- `verify_jwt=true` ;
- contrôle JWT + workshop + rôle ;
- OAuth refresh côté serveur ;
- bootstrap racine admin/directeur uniquement ;
- resolver véhicule basé sur OR/VIN Supabase ;
- resolver garantie basé sur claim Supabase ;
- dossiers marqués par `appProperties` stables ;
- auto-réconciliation d'un doublon concurrent en conservant le dossier géré le plus ancien et en mettant à la corbeille uniquement le doublon fraîchement créé ;
- initiation d'upload resumable ;
- validation basique MIME/taille avant toute création de dossier ;
- finalisation fail-closed par workshop + parent canonique + `local_id` ;
- lecture métadonnées sanitizée ;
- aucune intégration frontend à ce lot.

Tests après REVIEW :
- KHA-47 : 21/21 PASS ;
- IDENTITY-001C : 12/12 PASS après adaptation du contrat de configuration aux 3 Edge Functions ;
- TEAMDEV-RDV : PASS ;
- RECEPTION-UX-001B : PASS ;
- SECUX-001 : 42/42 PASS ;
- Supabase security contract : PASS ;
- sécurité locale/RGPD : PASS ;
- static startup safety : 7/7 PASS.

Corrections apportées pendant la revue :
- journalisation fail-closed dans `public.audit_logs` avant tout appel Google sensible ;
- matrice d'autorisation par contexte métier (Réception, Diagnostic, Repair, QC, Delivery, Warranty) ;
- `local_id` non stocké en clair dans `appProperties` : utilisation de SHA-256 pour respecter les limites Google et éviter une fuite inutile ;
- `finalize_upload` exige `local_id` et vérifie son hash ;
- réponses contenant une URI resumable en `Cache-Control: no-store` / `Pragma: no-cache` ;
- recherches de dossiers préparées à Shared Drive avec `supportsAllDrives/includeItemsFromAllDrives` ;
- refus fail-closed si l'audit n'est pas disponible ;
- aucun chemin Drive libre provenant du navigateur.

Aucun appel Google Drive réel, aucune création de dossier réelle, aucun secret réel et aucun déploiement Supabase n'ont été effectués pendant le build/review.
