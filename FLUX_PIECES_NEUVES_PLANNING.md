# Flux planning — pièces neuves : décision P1-008

## Statut actuel — DÉSACTIVÉ

La préparation anticipée automatique des pièces neuves est **désactivée** dans le planning actuel.

Le planner ne crée plus d'étape spéciale `Préparation anticipée pièces neuves` et ne crée jamais de réservation cachée à partir d'une ligne de pièce neuve/remplacée.

La fonction historique `schedulePipelineWithAnticipatedNewParts(...)` est conservée uniquement comme couche de compatibilité. Elle délègue directement à `scheduleSequentialPipeline(...)`. Le paramètre historique `split` ne déclenche aucune anticipation et le résultat conserve `anticipatedNewParts: null`.

## Décision P1-008

**Ne pas réactiver automatiquement l'anticipation des pièces neuves dans le scheduler.**

Cette décision clôt le comportement historique v22.02/v22.03. Une éventuelle anticipation future devra être conçue comme une nouvelle fonctionnalité explicite, et non comme le retour de l'ancien heuristique.

## Pourquoi cette décision

Le modèle de planning actuel est désormais PDF-first et task-first :

- les tâches validées/canoniques constituent la source de vérité ;
- les dépendances doivent être explicites ;
- `parallelizable` et `vehicleExclusive` doivent rester explicites ;
- les affectations `task.resourceIds` et `stepAssignmentLocks` restent des contraintes dures ;
- les préférences et continuités restent souples ;
- le planner ne doit pas inventer une tâche ou une dépendance cachée à partir d'une ligne de pièce.

L'ancien mécanisme d'anticipation faisait dépendre le planning d'une interprétation implicite des pièces remplacées. Cela n'est plus compatible avec le contrat canonique stabilisé par P1-003 à P1-007.

## Règle métier actuelle

Pour une pièce neuve ou remplacée :

1. aucune tâche supplémentaire n'est créée automatiquement ;
2. la préparation reste dans le flux normal validé ;
3. la peinture reste dans le flux normal validé ;
4. si le devis PDF ou une validation métier crée des tâches explicites, le planner respecte exactement leur graphe ;
5. aucune étape `anticipated-new-part` n'est persistée ;
6. aucune réservation spéciale n'est ajoutée à `state.bookings` ;
7. l'historique productif n'est jamais réécrit pour simuler une anticipation.

Si un travail doit réellement commencer en parallèle, il doit être représenté par une **tâche canonique explicite** avec son `taskId`, ses `dependencies`, ses ressources, `parallelizable`, `vehicleExclusive` et les autres contraintes nécessaires.

## Historique

L'anticipation des pièces neuves a existé dans les versions v22.02/v22.03. Elle pouvait créer une préparation parallèle sous conditions de capacité.

Lors de la stabilisation du flux PDF-first, cette optimisation a été neutralisée volontairement : la fonction de compatibilité a été conservée pour ne pas casser les anciens appels/cache, mais elle ne produit plus de comportement spécial.

Les anciennes notes de version qui décrivent l'anticipation sont donc **historiques** et ne décrivent pas le comportement actuel.

## Conditions minimales avant toute réactivation future

Une nouvelle fonctionnalité d'anticipation ne pourra être envisagée que dans une phase dédiée, avec validation explicite, et devra au minimum définir :

1. un état fiable de disponibilité/préparation des pièces ;
2. une frontière claire de création des tâches canoniques ;
3. des dépendances explicites, sans sérialisation cachée ;
4. des règles explicites de parallélisme et d'exclusivité véhicule ;
5. les ressources technicien/équipement et leurs capacités ;
6. la compatibilité avec les hard locks, préférences et continuités ;
7. la sécurité d'acceptation/CAS et l'immutabilité de l'historique productif ;
8. la compatibilité avec le scale gate P1-007 ;
9. les règles de migration et de relecture des anciens dossiers ;
10. des tests dédiés avant toute activation productive.

Jusqu'à ce qu'une telle phase soit explicitement approuvée, **l'anticipation automatique reste interdite**.

## Garde-fous de non-régression

Le comportement désactivé est protégé par :

- P1-001, scénario AF : l'appel de compatibilité est identique au flux séquentiel et ne crée aucune étape anticipée ;
- P1-003, scénario J : la compatibilité anticipated-parts reste désactivée ;
- `tests/audit.test.mjs` : aucune préparation anticipée automatique n'est créée et la préparation suit le flux normal ;
- P1-008 : test documentaire et statique dédié à cette décision.

## Impact release

P1-008 ne modifie pas le runtime, le schéma ou les données.

- version PWA : inchangée (`v23.3.8`) ;
- `DB_VERSION` : inchangé ;
- `CURRENT_DATA_SCHEMA_VERSION` : inchangé ;
- `CANONICAL_TASK_MODEL_VERSION` : inchangé ;
- aucune migration ;
- aucun SQL ;
- aucune opération Supabase live ;
- aucune réécriture de données productives.