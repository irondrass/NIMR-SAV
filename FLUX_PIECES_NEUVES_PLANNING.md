# Flux planning — préparation anticipée des pièces neuves

## Objectif

Le planning peut gagner du temps lorsqu'une pièce neuve à remplacer peut être préparée pendant que le véhicule est encore en tôlerie / démontage.

La règle est volontairement limitée : il n'existe **pas** d'étape `Peinture anticipée pièces neuves`. La peinture reste groupée avec les autres éléments du véhicule afin de conserver un flux atelier cohérent.

## Règle métier

Une étape `Préparation anticipée pièces neuves` est créée uniquement si toutes les conditions suivantes sont vraies :

1. une ligne de l'onglet `RDV & Planning` est marquée `Pièce neuve / remplacée` ;
2. cette ligne contient du temps de `Préparation` ;
3. le dossier contient une étape `Tôlerie + démontage` ;
4. une zone de préparation et un peintre sont libres au démarrage du créneau ;
5. cette préparation peut démarrer en parallèle de la tôlerie.

Si une zone ou un peintre n'est pas libre, le planning revient automatiquement au flux normal.

## Flux avec capacité libre

Exemple :

- préparation et peinture d'un nouveau pare-chocs ;
- dressage et peinture d'une porte avant droite.

Flux généré :

1. `Tôlerie + démontage` et `Préparation anticipée pièces neuves` démarrent en parallèle ;
2. `Préparation avant peinture` de la porte réparée ;
3. `Peinture + vernis` groupée : pare-chocs + porte avant droite ;
4. `Remontage` ;
5. `Finition + lavage`.

## Flux sans capacité libre

Si aucune zone de préparation ou aucun peintre n'est libre au démarrage, aucune anticipation n'est créée.

Flux généré :

1. `Tôlerie + démontage` ;
2. `Préparation avant peinture` : nouveau pare-chocs + porte avant droite ;
3. `Peinture + vernis` groupée : pare-chocs + porte avant droite ;
4. `Remontage` ;
5. `Finition + lavage`.

## Garde-fous

- Aucune anticipation pour les pièces à réparer / dresser.
- Aucune étape de peinture anticipée séparée.
- La peinture reste groupée dans le flux principal.
- Le remontage reste après la peinture groupée.
- Le contrôle qualité et la livraison ne changent pas.

## Tests ajoutés

Le fichier `tests/audit.test.mjs` vérifie :

1. création d'une seule étape `Préparation anticipée pièces neuves` quand la capacité est libre ;
2. absence de `Peinture anticipée pièces neuves` ;
3. retour au flux normal si la zone ou le peintre est occupé ;
4. absence d'anticipation pour une pièce à réparer.
