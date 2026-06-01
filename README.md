# v22.25 - Intégrité synchronisation multi-PC

- Remplacement de l’application brutale des sauvegardes Supabase entrantes par une fusion local/cloud par entité.
- Les dossiers, bookings, historiques et photos locales ne sont plus supprimés par simple absence dans l’état distant.
- Les tâches démarrées, terminées, avec sessions réelles ou liées à un dossier livré/facturé sont protégées contre les rétrogradations.
- Historique dossier fusionné en append-only pour éviter la perte d’événements terrain.
- Ajout d’un journal local de synchronisation et d’entrées de conflit lorsque des données locales protégées sont conservées.
- Snapshot local de sécurité mémorisé avant application d’une mise à jour distante.
- Cache PWA incrémenté en `nimr-sav-v22.25-sync-integrity`.

# v22.24 - Finitions revue publique

- Texte Cloud Supabase rendu durable : l'interface renvoie vers le dernier `supabase-schema.sql` du dépôt, sans mention d'ancien jalon.
- Sauvegarde chiffrée mise en action principale ; l'export JSON non chiffré est renommé et affiche un avertissement avant téléchargement.
- Création dossier clarifiée : un seul champ obligatoire `Immatriculation ou VIN`, avec un champ VIN complet optionnel si besoin.
- Libellés des boutons atelier clarifiés pour orienter vers le flux Technicien et l'override chef atelier.
- Cache PWA incrémenté en `nimr-sav-v22.24-public-review-fixes`.

# v22.23 PR 2B - Permissions réception, qualité, livraison et sensibles

- Extension des permissions aux flux réception/dossier : création, modification, import devis, planification RDV et réception véhicule.
- Séparation stricte des actions qualité (`quality.validate` / `quality.reject`) et livraison (`delivery.complete` / `case.close`).
- Protection des actions sensibles : suppression dossier, export/import sauvegarde, snapshots, configuration Supabase, PIN et nettoyage poste.
- Audit global enrichi pour les actions sensibles avec acteur courant (`userId`, `userName`, `userRole`, `resourceId`).
- Cache PWA incrémenté en `nimr-sav-v22.23-permissions-reception-quality-sensitive`.

# v22.23 PR 2A - Permissions technicien et planning

- Activation progressive des permissions sur les actions technicien : démarrer, pause, reprendre, terminer, bloquer et override.
- Verrouillage des mutations planning : replanification, affectation technicien, ressources, fast lane, horaires, jours fériés et congés/absences.
- Messages UI lisibles pour les actions refusées, avec boutons désactivés quand le rôle courant n'est pas autorisé.
- Cache PWA incrémenté en `nimr-sav-v22.23-permissions-technician-planning`.

# v22.23 - Fondations utilisateurs, rôles et acteur courant

- Ajout du modèle local `users` et `currentUserId`, avec migration douce des anciens états sans utilisateurs.
- Bootstrap automatique d’un premier administrateur local compatible offline.
- Ajout des rôles atelier et permissions centrales : admin, chef atelier, réception, technicien, qualité et lecture seule.
- Liaison préparée entre utilisateur et ressource planning (`resourceId`, `userId`, `authUserId`) sans imposer Supabase.
- Historique enrichi avec `userId`, `userName`, `userRole` et `resourceId`, en conservant `user` pour les anciens dossiers.
- Cache PWA initial de la phase rôles : `nimr-sav-v22.23-users-roles-foundation`.

# v22.22 - Responsive mobile et tablette

- Navigation mobile compacte : sidebar conservée sur desktop, barre compacte sur tablette, bottom bar sur smartphone.
- Formulaire de création dossier corrigé pour 320-520 px : une colonne, champs pleine largeur, boutons visibles et zones sans débordement horizontal.
- Vue Technicien adaptée tablette/téléphone : cartes verticales, actions tactiles minimum 44 px, accès direct depuis la navigation mobile.
- Planning smartphone enrichi avec une liste du jour lisible en plus du Gantt desktop/tablette.
- Cache PWA incrémenté en `nimr-sav-v22.22-mobile-responsive`.

# v22.21 - Sécurité planning et règles métier

- Protection du blocage dossier manuel : lever un blocage tâche ne supprime plus un blocage dossier saisi manuellement ni les autres tâches bloquées.
- Vérification des congés/absences sur l'intervalle réel de la tâche planifiée ou du reliquat repris.
- Sécurisation de la clôture globale des travaux : les tâches affectées à des techniciens doivent passer par le flux technicien ou par override chef atelier motivé et historisé.
- Précédence métier stabilisée par clés d'étapes, avec maintien de la préparation anticipée pièces neuves.
- Cache PWA incrémenté en `nimr-sav-v22.21-planning-safety`.

# v22.20 - Flux technicien atelier

- Ajout de la vue principale `Technicien` avec sélection technicien/date, cartes “Mes tâches”, statuts lisibles et actions terrain : démarrer, pause, reprendre, bloquer, noter, photographier, terminer et imprimer.
- Extension rétrocompatible des bookings avec `startedBy`, `pausedBy`, `resumedAt`, `completedBy`, blocage tâche, notes, photos liées, sessions de travail et durée réelle.
- Les statuts internes historiques restent conservés (`planned`, `started`, `paused`, `completed`, `temporary`) avec alias acceptés `in_progress` et `done`.
- Ajout du suivi chef atelier : tâches en cours, en pause, bloquées, terminées aujourd’hui, retards, techniciens sans tâche active et tâches sans technicien.
- Ajout de la fiche de travail technicien et de la fiche pause/blocage imprimables.
- Documentation ajoutée : `TECHNICIAN_FLOW.md` et `PRINTING.md`.
- Cache PWA incrémenté en `nimr-sav-v22.20-technician-flow`.

# v22.19 - Imprimés SAV professionnels

- Harmonisation des en-têtes imprimés : `NIMR SAV`, `Service Après-Vente Automobile`, type de document, référence dossier, Réf. OR, statut et date/heure d'impression.
- Ajout d'une fiche réception véhicule dans les exports ZIP et transformation de la fiche livraison en PV de restitution client plus complet.
- Enrichissement des ordres atelier, techniciens, complémentaires, planning journalier et Gantt avec statuts pièces, blocages, risques, horaires réels, pauses, observations et signatures métier.
- Checklist qualité adaptée au type d'intervention : service rapide, mécanique, électrique, diagnostic, carrosserie ou garantie.
- Export ZIP renforcé avec `Photos_globales` lorsque plusieurs ordres existent et classement par catégorie.
- Cache PWA incrémenté en `nimr-sav-v22.19-documents-sav`.

# v22.18 - Phase 1 cockpit atelier quotidien

- Ajout de la vue principale `Aujourd'hui` avec regroupement des dossiers : RDV attendus, véhicules reçus non planifiés, travaux à démarrer, travaux en cours, retards, qualité, livraisons prévues et dossiers bloqués.
- Ajout d'une fonction métier centralisée `getCaseNextAction(caseItem)` pour afficher une seule prochaine action cohérente dans la liste, le détail, le cockpit Aujourd'hui et le pilotage.
- Ajout d'un fil d'étapes dossier : Ouvert, RDV, Véhicule reçu, Main-d'œuvre, Validation, Planifié, En travaux, Qualité, Prêt livraison, Livré.
- Ajout d'un suivi simple `Pièces / blocage` par dossier : statut pièces, motif de blocage et détail libre, avec historique et priorité automatique sur `Résoudre le blocage`.
- Ajout d'un bandeau visible Local / Cloud / Connexion / Dernière sauvegarde / Modifications en attente.
- Le planning signale visuellement les réservations dont le dossier est bloqué sans supprimer automatiquement les créneaux existants.
- Cache PWA incrémenté en `nimr-sav-v22.18-cockpit`.

# v22.17 - Installation PWA et mode hors ligne

- Ajout des icônes PWA PNG `assets/icon-192.png`, `assets/icon-512.png` et `assets/apple-touch-icon.png`.
- Mise à jour du manifest avec icônes 192/512 en `purpose: any maskable` pour Chrome/Edge Windows, Android et iOS.
- Ajout d'un écran `offline.html` explicite : les données locales restent consultables et Supabase reprend à la reconnexion.
- Ajout d'une bannière hors ligne dans l'application lorsque le poste perd la connexion.
- Cache PWA incrémenté en `nimr-sav-v22.17-pwa-install`.
- Ajout d'un test navigateur console/PWA sans dépendance externe dans `tests/browser_console_smoke.mjs`.

# v22.16 - CSP console propre et sécurité locale renforcée

- Correction CSP : `connect-src` autorise maintenant `https://cdn.jsdelivr.net` pour éviter le blocage console des source maps CDN, sans réintroduire `unsafe-inline` dans `script-src`.
- Les appels au verrou local sont protégés au démarrage, même si un script de sécurité local ne se charge pas correctement.
- Le PIN local conserve uniquement un hash PBKDF2-SHA256 avec salt, ajoute un compteur de tentatives, un verrouillage temporaire et un verrouillage automatique après inactivité.
- Ajout de “Désactiver le PIN” et rappel visible : le PIN ne chiffre pas les données locales.
- Nettoyage poste élargi : localStorage, sessionStorage, sessions Supabase locales, IndexedDB applicatives, caches `nimr-*` et service worker.
- Ajout du test de sauvegarde chiffrée sans restauration, avec métadonnées non sensibles dans l'enveloppe `.nimrsecure`.
- Détection de conflit multi-PC avant d'appliquer une sauvegarde cloud distante sur un poste qui possède des modifications locales non synchronisées.
- Cache PWA incrémenté en v22.16.

# v22.15 - Sécurité locale et mise à jour contrôlée

- Ajout d'un verrouillage local par PIN dans Paramètres > Sécurité du poste. Il protège la session sur un PC partagé, sans remplacer l'authentification Supabase.
- Ajout d'un export de sauvegarde chiffré par mot de passe (`.nimrsecure`) et d'un import capable de restaurer ces sauvegardes.
- Ajout d'un bouton “Nettoyer ce poste” qui supprime les données locales, IndexedDB, caches PWA et l'enregistrement du service worker sur le navigateur courant.
- La PWA ne force plus le rechargement automatique pendant la saisie : une bannière “Nouvelle version disponible” laisse l'utilisateur enregistrer puis recharger au bon moment.
- La CSP retire `unsafe-inline` de `script-src`; les styles inline hérités restent tolérés temporairement pendant la migration progressive.
- Cache PWA incrémenté en v22.15.

## Procédure sécurité atelier

- Activer un PIN local sur chaque poste partagé depuis Paramètres > Sécurité du poste.
- Utiliser en priorité “Exporter sauvegarde chiffrée” pour les sauvegardes contenant clients, VIN, immatriculations, photos ou historiques.
- Stocker le mot de passe de sauvegarde hors du PC atelier, dans une procédure interne contrôlée.
- Tester une restauration complète après chaque sauvegarde importante.
- Utiliser “Nettoyer ce poste” avant de céder un PC, changer d'utilisateur durablement ou diagnostiquer un navigateur compromis.

# v22.14 - Libération planning et sync multi-PC instantanée

- Le bouton global de finalisation travaux clôture maintenant les réservations productives du dossier et libère le temps restant dans le planning, sans valider le contrôle qualité.
- Une tâche démarrée puis terminée avant la fin prévue est tronquée à l’heure réelle de fin ; une tâche future clôturée avec le dossier est supprimée du Gantt pour rendre la ressource disponible.
- Les réservations terminées ne bloquent plus la recherche des prochains créneaux atelier.
- La synchronisation Supabase pousse les actions critiques immédiatement, réduit le délai de sauvegarde automatique à 1,5 s et utilise un polling de secours toutes les 3 s si Realtime n’est pas disponible.
- Cache PWA incrémenté en v22.14.

# v22.13 - Test réel guichet et main-d’œuvre manuelle

- Le dossier rapide ne renvoie plus vers “Créer un OR” quand le premier ordre existe déjà : la prochaine action devient “Saisir la main-d’œuvre”.
- La zone “Ajouter / modifier la main-d’œuvre de l’ordre” est ouverte et visible quand aucun devis n’a été importé.
- Un dossier créé sans devis démarre à 0 h atelier : le planning n’est alimenté que par la main-d’œuvre saisie ou importée.
- Le guichet rapide crée par défaut un ordre service rapide / entretien ; l’assurance expert reste un choix explicite.
- Ajout des champs opérationnels : Réf. OR, kilométrage, téléphone client, propriétaire/société, personne déposante et téléphone déposant.
- Les fiches PDF et la synchronisation structurée conservent les informations déposant/propriétaire dans les détails du dossier.

# v22.12 - Synchronisation cloud multi-PC

- Les suppressions de dossiers sont envoyées immédiatement vers Supabase.
- Au chargement, au retour sur l'onglet et au retour réseau, l'application tire la dernière sauvegarde cloud si elle est plus récente que le dernier cloud connu.
- Correction du cas où une sauvegarde locale de rafraîchissement empêchait un autre PC de recevoir une suppression.

# v22.11 - Correction recherche véhicule guichet rapide

- Le champ visible `Immatriculation ou VIN` déclenche maintenant la recherche automatique dans la base véhicules.
- La recherche accepte une immatriculation, un VIN complet ou un fragment de VIN.
- Cache PWA incrémenté en v22.11 pour forcer le rechargement de `app.js` et `js/storage.js`.

# v22.10 - Sécurisation cloud et guichet rapide

- Retrait de la configuration Supabase codée en dur : l'URL projet, la clé anon publique, l'ID atelier et la clé de sauvegarde se configurent maintenant depuis Paramètres > Cloud Supabase et restent locaux au navigateur.
- Le schéma Supabase ajoute `workshops`, `workshop_members`, `workshop_id` sur les tables métier et des politiques RLS par atelier. Pour une installation actuelle, exécutez le dernier `supabase-schema.sql` du dépôt avant d'activer la synchro stricte.
- La synchronisation cloud écrit maintenant `workshop_id` et utilise les contraintes composites par atelier, avec repli temporaire sur l'ancien schéma pour éviter une coupure brutale.
- Ajout du mode “guichet rapide” dans la création dossier : seuls les champs essentiels restent visibles, l'ancien formulaire complet reste accessible en décochant le mode.
- Cache PWA incrémenté en v22.10.

# v22.09 - Audit pré-production atelier

- Les impressions Planning journalier et Gantt n'affichent plus les congés/absences comme des travaux à réaliser ; ils restent visibles dans le planning écran et continuent de bloquer la ressource.
- Un RDV manqué ou en attente de report renvoie maintenant le bouton Continuer vers Planning/RDV, au lieu de pousser l'utilisateur vers une réception impossible.
- L'ajout d'une absence ressource est bloqué si elle chevauche déjà une tâche atelier : l'utilisateur doit replanifier une tâche non démarrée ou mettre en pause une tâche en cours avant d'ajouter l'absence.
- Ajout de tests de régression pour planning sans devis avec main-d’œuvre manuelle, impressions sans congés, conflit absence et report RDV.
- Cache PWA incrémenté en v22.09.

# v22.08 - Flux atelier réel et planification plus simple

- Les ordres SAV peuvent maintenant réserver un créneau dès que la main-d’œuvre est connue et que les validations assurance nécessaires sont faites ; la validation client/interne reste obligatoire avant démarrage réel des travaux.
- La création d’un dossier accepte un véhicule partiellement connu : le planning exige toujours une immatriculation ou un VIN avant calcul, mais l’accueil peut ouvrir le dossier plus vite.
- Le vocabulaire “accord client” est clarifié en “validation client/interne” pour les flux service rapide, mécanique, électrique, diagnostic et garantie.
- Ajout de tests de régression sur le flux réel service rapide : planification prévisionnelle, blocage du démarrage sans validation, puis démarrage après validation.
- Cache PWA incrémenté en v22.08.

# v22.07 - NIMR SAV global et synchronisation multi-PC

- Renommage métier de l'application en NIMR SAV : le planning couvre service rapide, carrosserie, mécanique, électrique, diagnostic et garantie.
- Ajout de la saisie manuelle de main-d’œuvre dans chaque ordre de travail, avec ajout/suppression de lignes et recalcul immédiat des durées planning.
- Les ordres client, vidange, mécanique, électrique, diagnostic et garantie ne demandent plus d’accord expert assurance ; seul l’ordre assurance conserve le flux expert + client.
- Synchronisation Supabase renforcée : sauvegarde cloud plus rapide, écoute Realtime de `cloud_backups` et polling de secours pour propager les changements entre plusieurs PC connectés.
- Cache PWA incrémenté en v22.07.

# v22.06 - Pilotage dynamique des tâches atelier

- Ajout d'actions sur chaque tâche du planning validé : démarrer, terminer maintenant, mettre en pause avec cause et replanifier une tâche non démarrée.
- Une tâche terminée avant l'heure libère ses segments futurs dans le Gantt ; une pause conserve la partie réalisée et crée un reliquat planifié selon les disponibilités atelier.
- Le planning global affiche les statuts Planifiée / En cours / En pause / Terminée, et les états sont conservés dans la sauvegarde locale.
- Cache PWA incrémenté en v22.06.

# v22.05 - Persistance renforcée après fermeture

- La sauvegarde locale priorise maintenant la sauvegarde la plus récente au redémarrage, au lieu de restaurer parfois un ancien snapshot plus volumineux.
- La sauvegarde d'urgence de fermeture écrit aussi les métadonnées et un point de restauration.
- Ajout d'une sauvegarde périodique toutes les 10 secondes pour limiter la perte de modifications si l'onglet GitHub Pages est fermé brutalement.
- Cache PWA incrémenté en v22.05.

# v22.04 - KPI SAV dans le pilotage

- Ajout d'un bloc KPI SAV dans l'onglet Pilotage : RDV du jour, réceptions en retard, véhicules atelier, travaux en cours, qualité à traiter, livraisons à risque, accords complets et délai moyen estimé.
- Restauration de la zone d'alertes SAV dans Pilotage, au-dessus du Kanban.
- Cache PWA incrémenté en v22.04.

# v22.03 - Anticipation pièces neuves verrouillée par capacité réelle

- La préparation anticipée des pièces neuves est annulée si le peintre ou la zone de préparation sont occupés pendant la fenêtre de démarrage de la tôlerie.
- Correction de cohérence PWA : `index.html`, `app.js` et `sw.js` pointent tous vers la version v22.03 et le nettoyage conserve le `CACHE_NAME` réel.
- Cache PWA incrémenté en v22.03.

# v22.02 - Préparation anticipée conditionnelle des pièces neuves

- Suppression de toute étape séparée de peinture anticipée.
- La préparation anticipée des pièces neuves est créée uniquement si un peintre et une zone de préparation sont libres au démarrage de la tôlerie.
- Si la capacité n’est pas libre, le planning garde le flux normal.
- Cache PWA incrémenté en v22.02.

# v21.98 - Vérification dernière archive et correction import

- Correction de regex corrompues dans l'import devis à la création : les limites de mots `\b` sont restaurées pour mieux détecter type d'ordre, numéro devis, numéro OR, VIN, immatriculation, téléphone et kilométrage.
- Rétablissement de l'onglet interne `Photos`, dont le panneau existait encore mais n'était plus accessible dans la navigation du dossier.
- L'enregistrement du service worker pointe maintenant vers `sw.js?v=21.97`.
- Cache PWA incrémenté en v21.98 pour forcer la prise en compte de la mise à jour.

# v21.91 - Verrouillage livraison et validation MO renforcés

- Les accords expert/client refusent maintenant les devis qui ne contiennent aucune heure de main-d’œuvre réelle, même si une ligne existe à 0 h.
- La livraison vérifie désormais toute la chaîne concessionnaire : RDV, réception physique, démarrage, fin travaux, affectation atelier et contrôle qualité.
- Ajout de tests de régression sur les devis à 0 h et les dossiers importés/incohérents qui tentaient de passer directement en livraison.
- Cache PWA incrémenté en v21.91.

# v21.89 - Flux atelier concessionnaire corrigé

- Ajout d’une étape métier explicite `Travaux terminés` entre `Démarrer travaux` et `Contrôle qualité`, afin d’éviter une validation qualité alors que la production n’est pas clôturée.
- Livraison assurance bloquée tant qu’aucune photo `Après réparation` n’est jointe au dossier.
- Nettoyage d’un doublon `includeInPlanning` dans la normalisation des ordres.
- Export dossier enrichi avec l’état `Travaux terminés`.
- Synchronisation Supabase et statut dossier mis à jour pour distinguer `in_progress`, `work_completed`, `quality_approved` et `delivered`.
- Cache PWA incrémenté en v21.89.

# v21.88 - Flux atelier concessionnaire renforcé

- Correction du flux d’accords : les boutons globaux accord expert / accord client valident maintenant les ordres de réparation inclus, au lieu de rester bloqués par leur propre prérequis.
- Le calcul de RDV vérifie les accords réellement portés par les ordres de réparation, pas seulement les anciens drapeaux globaux du dossier.
- Ajout de la conservation des observations de réception (`arrivalNotes`) et affichage dans la carte réception.
- Cache PWA incrémenté en v21.88.

# v21.76 - Heure complète dans les tâches Gantt

- Le badge horaire du planning Gantt affiche maintenant toujours l’heure complète quand la tâche est assez large.
- Le badge de numéro reste séparé de l’heure.
- Les tâches trop courtes gardent seulement le numéro de tâche, sans texte tronqué.
- Le cache PWA est incrémenté en v21.76.

# v21.75 - Badge numéro séparé de l’heure Gantt

- Le numéro de tâche n’est plus superposé au badge horaire.
- Sur une tâche lisible, l’heure reste en haut à droite et le numéro se place en bas à droite.
- Sur une tâche trop courte, seul le numéro de tâche reste centré dans la carte.
- Le cache PWA est incrémenté en v21.75.

# v21.75 - Badges seuls pour tâches courtes Gantt

- Les tâches trop étroites dans le planning n’affichent plus de texte tronqué avec « ... ».
- Elles affichent uniquement le numéro de tâche, avec détail disponible au survol et dans la liste d’impression.
- Le cache PWA est incrémenté en v21.74.

# v21.74 - Impression Gantt lisible avec tâches courtes

- Ajout de badges numérotés sur chaque tâche du Gantt imprimé.
- Ajout d’une liste détaillée des tâches sous le Gantt pour retrouver les créneaux trop courts.
- Les tâches de petite durée restent visibles même si leur barre est étroite.
- Le cache PWA est incrémenté en v21.74.

## v21.74
Correction de l’impression du planning journalier afin que les tâches courtes restent exploitables sur A4 paysage.


## v21.80
- Correction du rechargement automatique des nouvelles versions PWA : stratégie network-first pour l'application, activation immédiate du nouveau service worker et rechargement sécurisé après autosave d'urgence.
- Ajout d'un contrôle de sauvegarde automatique dans Atelier > Sauvegarde : principal, miroir local, snapshots, dernière sauvegarde cloud.
- Ajout des actions Télécharger copie de sécurité et Restaurer dernier point automatique.


## v21.80

- Ajout du script `supabase-create-repair-claims.sql` pour creer uniquement les tables manquantes `repair_claims` et `repair_claim_labor_lines`.
- Messages Supabase mis a jour pour demander le schema v21.80.
- Cache PWA incremente pour forcer le rechargement de la mise a jour.
