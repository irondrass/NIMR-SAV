# Backlog post v23.1.6

Statut : backlog de préparation, sans démarrage de v23.1D.

Ce document organise les améliorations à traiter après la stabilisation
`v23.1.6` version/cache consistency. Il ne déclenche pas de développement
fonctionnel immédiat et ne crée aucun tag de release.

## Garde-fous

- Ne pas commencer l'écran technicien simplifié `v23.1D` avant stabilisation
  confirmée de `v23.1.6` puis `v23.1.7`.
- Ne pas réintroduire de données réelles dans `data/vehicles.json`.
- Ne pas créer de tag sans validation publique explicite.
- Garder les changements de chaque release vérifiables par tests ciblés.
- Préserver la cohérence version/cache à chaque incrément.

## v23.1.7 - UX, accessibility and security hardening

Objectif : réduire le risque XSS, améliorer l'accessibilité clavier et rendre
les messages de sécurité plus explicites avant tout nouveau gros écran.

### Travaux

- Auditer et durcir les usages dynamiques de `innerHTML`.
- Remplacer les interpolations dangereuses par `textContent`, DOM APIs ou
  échappement systématique lorsque le rendu HTML est indispensable.
- Ajouter des tests XSS sur les champs client.
- Ajouter des tests XSS sur les notes.
- Ajouter des tests XSS sur les réclamations.
- Ajouter des tests XSS sur le journal / historique.
- Ajouter un style global `:focus-visible` clair et cohérent avec l'UI.
- Vérifier les modales PIN et login au clavier : tab order, focus initial,
  validation Enter, fermeture Escape si applicable, retour focus.
- Ajouter `aria-hidden="true"` aux SVG purement décoratifs.
- Clarifier les libellés et parcours entre `Réception guidée` et
  `Dossier complet`.
- Améliorer les messages d'erreur pour les actions bloquées, permissions,
  sync/cloud, PIN/login et données invalides.
- Renforcer l'avertissement sécurité : le PIN protège l'interface locale,
  mais ne chiffre pas les données locales.

### Tests attendus

- Tests XSS automatisés couvrant client, notes, réclamations et journal.
- Tests DOM/HTML confirmant l'absence de payload injecté dans les rendus
  sensibles.
- Smoke test clavier pour login/PIN et modales critiques.
- Vérification CSS de `:focus-visible` sur les contrôles principaux.
- Test ou audit statique des SVG décoratifs avec `aria-hidden="true"`.

### Critères de sortie

- Aucun rendu utilisateur sensible ne dépend d'un `innerHTML` non durci.
- Les parcours login/PIN restent utilisables sans souris.
- Les messages de sécurité ne laissent pas croire que le PIN chiffre les
  données locales.
- La version/cache reste cohérente et vérifiée avant publication.

## v23.1.8 - Roles and governance hardening

Objectif : séparer les responsabilités métier de direction SAV et
d'administration technique, puis verrouiller la matrice de permissions.

### Travaux

- Séparer le rôle `Directeur SAV` du rôle `Admin technique`.
- Conserver au `Directeur SAV` :
  - dashboard ;
  - dossiers ;
  - planning ;
  - KPI ;
  - exports ;
  - override livraison.
- Conserver à `Admin technique` :
  - configuration cloud ;
  - nettoyage poste ;
  - suppression données ;
  - restauration complète ;
  - gestion des permissions critiques.
- Mettre à jour les libellés UI des rôles et permissions.
- Mettre à jour les gardes d'accès des actions sensibles.
- Historiser les refus ou overrides critiques quand c'est pertinent.
- Documenter la matrice de permissions effective.

### Tests attendus

- Tests permissions pour `Directeur SAV`.
- Tests permissions pour `Admin technique`.
- Tests de non-régression pour admin existant, chef atelier, réception,
  technicien, qualité et lecture seule.
- Tests d'accès refusé sur config cloud, nettoyage poste, suppression données,
  restauration complète et permissions critiques.
- Tests d'accès autorisé sur dashboard, dossiers, planning, KPI, exports et
  override livraison pour `Directeur SAV`.

### Critères de sortie

- Aucune permission technique critique n'est accordée par héritage au
  `Directeur SAV`.
- `Admin technique` peut administrer le poste et la gouvernance sans devenir
  acteur métier SAV par défaut.
- Les tests permissions décrivent la matrice attendue et bloquent les
  régressions.

## v23.2.0 - SAV performance dashboard

Objectif : créer un tableau de performance SAV exploitable en pilotage
hebdomadaire et mensuel, après stabilisation UX/sécurité/gouvernance.

### Travaux

- Ajouter la date promise client au dossier.
- Calculer le KPI de respect délai.
- Identifier les dossiers bloqués pièces.
- Mesurer le temps d'attente accord client.
- Mesurer le temps d'attente accord expert.
- Ajouter le taux de contrôle qualité refusé.
- Ajouter le taux de retour après livraison.
- Ajouter un export de rapport hebdomadaire.
- Ajouter un export de rapport mensuel.
- Prévoir des filtres par période, statut, type d'ordre et responsable si les
  données existantes le permettent.

### Tests attendus

- Tests de calcul date promise client et respect délai.
- Tests de comptage des dossiers bloqués pièces.
- Tests de durées d'attente accord client/expert.
- Tests de taux qualité refusée et retour après livraison.
- Tests exports hebdomadaire/mensuel avec période, totaux et libellés.

### Critères de sortie

- Les KPI sont calculés depuis des champs historisés ou explicitement stockés.
- Les exports sont lisibles par direction SAV sans retraitement manuel lourd.
- Les calculs documentent les cas ambigus : dossier annulé, livraison sans date
  promise, accord non requis, contrôle qualité non applicable.

## Ordonnancement

1. Finaliser et valider publiquement `v23.1.6` version/cache consistency.
2. Réaliser `v23.1.7` et stabiliser les tests UX/accessibilité/sécurité.
3. Reconsidérer seulement ensuite le démarrage éventuel de `v23.1D`.
4. Réaliser `v23.1.8` pour figer la gouvernance des rôles.
5. Réaliser `v23.2.0` quand les données de pilotage sont fiables.
