# Clôture technique de l’audit UX / métier — v23.3.34

Date : 6 septembre 2026. Application concernée : le site publié NIMR-SAV et sa copie `__github_publish_NIMR_SAV`.

Les 20 frictions de l’audit du 5 septembre ont reçu une correction dans v23.3.33 et v23.3.34. Le présent relevé décrit les comportements livrés et leurs preuves. Il ne remplace pas une observation des utilisateurs en atelier : les gains de temps et l’adoption devront être mesurés en usage réel.

| Point | Correction livrée | Vérification |
|---|---|---|
| F01 — Synchronisation des rôles métier | Transport automatique séparé des commandes administratives, droits métier conservés, envoi durable et accusé serveur explicite. | Recette des rôles et du transport, outbox, concurrence ; contrôle SQL des droits et des réponses CAS. |
| F02 — Présence et finalisation | Présence jusqu’à remise physique, y compris dossiers anciennement clos. CQ puis remise ; refus de clôture prématurée et de CQ avec opération ouverte. | Gardes métier, parcours navigateur CQ/remise, contrôle SQL en production avec annulation des données fictives. |
| F03 — Accord travaux | L’import et l’arrivée minimale créent des travaux non autorisés. Référence d’accord explicite par périmètre, vérifiée au démarrage. | Recette métier et technicien, import canonique. |
| F04 — ETA / promesse | Prévision incertaine affichée « À confirmer ». Le recalcul ne réécrit plus le rendez-vous. Promesse communiquée, prochain contact et dernier échange sont séparés et persistés. | Normalisation aller-retour, alertes d’échéance, saisie navigateur, contrôle serveur des modifications. |
| F05 — Phase / activité | Six phases véhicule dérivées. Une réception, une affectation ou le blocage d’une tâche non démarrée ne valent plus début d’exécution. | Recette des phases et des filtres. |
| F06 — Reprise / blocage | Résolution de cause explicite, contrôles avant reprise ; portée du blocage affichée. La portée conservatrice actuelle est le véhicule et sa chaîne de travaux. | Recette technicien et gardes de démarrage ; aucune reprise ne contourne une dépendance ou une indisponibilité. |
| F07 — Aujourd’hui | Liste unique par véhicule, exceptions prioritaires, filtres attendus / engagements / contacts / qualité ; équipe en complément pour le Chef. | Recette des exceptions et parcours navigateur. |
| F08 — Action contextuelle | Panneau ouvert depuis Aujourd’hui pour décisions, réception, CQ, remise et suivi client ; retour à la liste conservé. | Parcours navigateur sans passage obligatoire par la fiche complète. |
| F09 — Disponibilité | Horaires, absences et réservations pris en compte ; prochaine opération exécutable distinguée de celle simplement prévue ; affectation indisponible signalée. | Lectures communes avec le calendrier et les contraintes de planification ; recette technicien et DAG. |
| F10 — Opérations PDF | Chaque opération source reste distincte, même dans une phase commune. Durées, identifiants, dépendances et provenance sont préservés. | Cas de trois opérations dont deux de carrosserie ; 15 scénarios du modèle canonique. |
| F11 — Arrivée sans PDF | Entrée minimale : identité du véhicule et motif, client/contact facultatifs ; doublon actif détecté. Aucun travail exécutable inventé. | Recette métier et soumission réelle du formulaire dans le navigateur. |
| F12 — Navigation par rôle | Chef : 5 entrées ; Directeur : 4 ; Réception et CQ : 2 ; Technicien : 1. CQ arrive sur sa file de véhicules à contrôler. | Contrats des rôles et parcours navigateur CQ/Réception. |
| F13 — Fiche technicien | Opération, véhicule, consigne et temps au premier niveau ; ressources, horaires et provenance en détails. | Recette mobile aux largeurs réelles de 360, 390 et 430 px. |
| F14 — Actions mobiles | Deux actions principales, autres actions secondaires ; aucune barre d’actions à défilement horizontal. | Mesure DOM : absence de débordement et cibles de 44 px minimum. |
| F15 — Dialogues | Un panneau par action, commentaire facultatif intégré ; confirmations utilisables également depuis le panneau contextuel. | Fin de tâche, note hors ligne, contrôle qualité et remise en navigateur. |
| F16 — Prêt / démarrage | Étiquette de disponibilité issue des mêmes gardes que le démarrage. | Recette technicien, droits, dépendances et contraintes. |
| F17 — Replanification | Sélecteur natif date/heure, aperçu du créneau admissible avant validation ; Gantt borné par les horaires de l’atelier. | Contraintes de planification conservées ; recettes métier et DAG. |
| F18 — Pilotage | Quatre indicateurs immédiats, exceptions avec responsable et échéance ; clic vers les identifiants exacts des véhicules comptés, charge vers le planning. | Lecture du filtre commun et parcours des vues ; synthèses secondaires repliées. |
| F19 — Synchronisation compréhensible | État par dossier, attente de confirmation explicite, indication du Chef / administrateur pour résoudre un conflit ; état réseau technicien actualisé à la reconnexion. | Outbox hors ligne : IDs et clés d’idempotence conservés ; sans serveur aucun faux accusé ; CAS et rejeu vérifiés en SQL. |
| F20 — Fiche véhicule | Résumé opérationnel et décisions au premier niveau ; sections documentaires, historiques et administratives repliées. | Parcours navigateur et vérification responsive. |

## Sécurité Supabase appliquée

La migration `20260906001634_audit_completion_private_api.sql` a été appliquée dans le projet de production. Les implémentations privilégiées sont déplacées dans `nimr_internal`, les signatures publiques sont conservées via des fonctions invoquantes, et les droits existants ne sont pas élargis. Des gardes serveur protègent les engagements client et la finalisation. Les clés étrangères sans couverture ont reçu un index ; `btree_gist` est déplacée vers `extensions`.

Le contrôle après déploiement a renvoyé PASS : fonctions privées, droits, refus d’un non-membre, clôture et CQ prématurés, opération encore ouverte, conflit de version, décision valide, préservation des autres champs, rejeu idempotent et droits sur la promesse client. Toutes les données synthétiques ont été annulées par ROLLBACK. Le script reproductible est `tests/audit_completion_supabase_verification.sql`.

Le panneau Advisor ne signale plus les fonctions privilégiées exposées, l’extension dans `public` ni les clés étrangères sans index. Il reste la protection contre les mots de passe compromis, explicitement réservée au forfait Pro dans les réglages Supabase, et des informations « Unused Index ». Aucun abonnement n’a été souscrit ; les index utiles aux relations et aux contraintes sont conservés.

## Recette et limites

Commande de recette de cette livraison : `node tests/run-audit-release.mjs` (Chrome ou Edge requis pour les profils simulés). Résultat de la recette finale : 22 suites réussies, 0 échec, en 66,4 secondes. Elle couvre dont les scénarios métier, le modèle canonique, les rôles, les verrous de clôture, le DAG, la concurrence, l’outbox, les parcours mobiles et le déploiement PWA. Le contrôle du cache comprend 49 scénarios ; celui de la portabilité des empreintes en comprend 10. Le test mobile sert une configuration distincte, sans endpoint Supabase de production.

Les anciens tests qui figent une version antérieure, des fichiers entiers ou des parcours volontairement remplacés restent dans le dépôt. Cette livraison ne prétend pas rendre verte l’intégralité de ces contrats historiques ; elle possède une recette d’acceptation explicite. Les scénarios sur téléphone sont simulés dans Chromium, sans certification sur appareils physiques. Aucun chronométrage d’une équipe en atelier ni intégration ERP n’est revendiqué : l’audit rendait cette dernière conditionnelle à un besoin de ressaisie constaté.

Empreinte canonique des 23 fichiers exécutés de v23.3.34 : `61b4782c03c175a1b5bde44ab9f52f1990ff1e268740307c8485323db0b2e2b4`. Les empreintes des versions précédentes sont inchangées.
