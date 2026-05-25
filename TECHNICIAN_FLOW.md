# Flux technicien NIMR SAV

## Objectif

Le flux technicien sépare le suivi terrain du suivi administratif du dossier.

- **Dossier** : véhicule, client, accords, rendez-vous, qualité, livraison.
- **Ordre de réparation** : demande SAV, devis, main-d’œuvre et pièces.
- **Tâche atelier** : créneau réel affecté à un technicien dans le planning.

Le technicien agit sur la tâche atelier, sans clôturer automatiquement le dossier complet.

## Statuts internes conservés

Les statuts stockés dans les bookings restent rétrocompatibles :

- `planned` : planifiée ;
- `started` : en cours ;
- `paused` : mise en pause avec reliquat ;
- `completed` : terminée ;
- `temporary` : simulation planning.

Les alias entrants sont acceptés :

- `in_progress` devient `started` ;
- `done` devient `completed`.

## Statuts affichés côté Technicien

La vue Technicien affiche un statut métier dérivé :

- `planned` : pas encore prête ;
- `ready` : prête à démarrer ;
- `in_progress` : en cours ;
- `paused` : en pause ;
- `blocked` : bloquée ;
- `done` : terminée ;
- `quality_pending` : contrôle qualité à faire.

## Règles de démarrage

Une tâche peut être démarrée seulement si :

- le véhicule est réceptionné ;
- les validations client / interne nécessaires sont enregistrées ;
- la tâche est affectée au technicien sélectionné ;
- le technicien n’a pas déjà une tâche active ;
- la tâche précédente obligatoire est terminée ;
- le dossier et la tâche ne sont pas bloqués ;
- le technicien n’est pas en indisponibilité au moment du démarrage.

Le chef atelier peut traiter les exceptions depuis le suivi atelier, mais l’application conserve l’historique.

## Pause et reliquat

La pause exige un motif :

- pause repas ;
- attente pièces ;
- attente accord ;
- attente expert ;
- attente chef atelier ;
- panne outil / ressource ;
- autre.

Quand une tâche est mise en pause, l’application conserve le temps travaillé et crée un reliquat planifié. La reprise se fait sur ce reliquat, afin de garder une trace claire de l’arrêt initial.

## Blocage

Le blocage d’une tâche enregistre :

- le motif ;
- le commentaire ;
- le technicien ;
- la date et l’heure ;
- l’impact dossier si le blocage empêche la suite.

Un dossier bloqué remonte dans le cockpit atelier et dans la vue chef atelier.

## Fin de tâche

À la fin d’une tâche, l’application enregistre :

- `completedAt` ;
- `completedBy` ;
- la durée réelle estimée ;
- la note de fin si renseignée ;
- l’historique.

Si toutes les tâches atelier productives sont terminées, le dossier passe à l’état “travaux terminés” et attend le contrôle qualité. La livraison n’est jamais validée automatiquement.

## Test manuel rapide

1. Ouvrir **Technicien**.
2. Choisir un technicien et la date du jour.
3. Démarrer une tâche prête.
4. Vérifier que le statut passe en cours.
5. Essayer de démarrer une deuxième tâche du même technicien : l’application doit refuser.
6. Mettre la tâche en pause avec motif.
7. Vérifier que le reliquat apparaît.
8. Reprendre le reliquat.
9. Ajouter une note et une photo.
10. Terminer la tâche.
11. Vérifier l’historique du dossier.
12. Si c’était la dernière tâche productive, vérifier que le dossier attend le contrôle qualité.
