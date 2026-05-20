# Audit et améliorations - Flux atelier automobile

## Flux cible retenu

Le flux métier doit suivre une logique d'atelier/concessionnaire :

1. Création du dossier véhicule et identification client.
2. Ajout des photos avant réparation.
3. Création d'un ou plusieurs ordres de réparation / sinistres.
4. Import ou saisie du devis par ordre.
5. Accord expert uniquement pour les ordres assurance.
6. Accord client obligatoire avant planification.
7. Prise de rendez-vous et affectation atelier.
8. Réception physique du véhicule.
9. Démarrage travaux.
10. Contrôle qualité.
11. Livraison.

## Défauts détectés et corrigés

### 1. Blocage logique des boutons d'accord

Les boutons globaux `Accord expert` et `Accord client` pouvaient être bloqués par la condition qu'ils devaient justement valider. Cela créait un flux incohérent : l'application demandait de valider l'accord avant d'autoriser l'action de validation.

Correction :
- l'action globale `expertApproved` valide maintenant les ordres assurance inclus dans le flux ;
- l'action globale `clientApproved` valide les ordres inclus ;
- les statuts des ordres sont synchronisés après l'action ;
- les règles d'accès au RDV lisent les validations réelles des ordres, pas seulement les anciens drapeaux globaux du dossier.

### 2. Risque de RDV autorisé avec des accords incohérents

Le contrôle du rendez-vous utilisait des indicateurs globaux du dossier. En présence de plusieurs sinistres / ordres, cela pouvait devenir moins fiable que le contrôle par ordre.

Correction : le RDV vérifie maintenant chaque ordre inclus : devis avec main-d'œuvre, accord expert si assurance, accord client.

### 3. Observations de réception non conservées dans le modèle normalisé

Le champ `arrivalNotes` existait dans l'interface mais n'était pas conservé lors de la normalisation du dossier.

Correction :
- ajout de `arrivalNotes` dans `normalizeCase()` ;
- affichage des observations de réception dans la carte de réception ;
- rétrocompatibilité avec `receptionNotes` si présent dans d'anciennes données.

## Tests ajoutés

Des tests de régression ont été ajoutés pour :

- vérifier que les observations de réception sont conservées ;
- vérifier que l'accord expert global débloque bien le flux et valide l'ordre assurance ;
- vérifier que l'accord client global débloque bien le flux et fait passer le dossier vers la planification.

## Tests exécutés

- `node tests/smoke.test.mjs`
- `node tests/estimate_regression.mjs`

Les deux suites passent après correction.

## Recommandations restantes

1. Remplacer progressivement les anciens boutons globaux d'accord par des actions contextualisées par ordre, car c'est plus proche de la réalité atelier.
2. Ajouter une étape explicite `Travaux terminés` séparée de `Contrôle qualité` afin de distinguer fin de production et validation finale.
3. Ajouter une validation de livraison qui exige au minimum : contrôle qualité validé, dossier client exportable, photos après réparation si le dossier assurance le nécessite.
4. Ajouter un journal clair des modifications critiques : retrait accord client, report RDV, modification devis après planification.
5. Prévoir un état `Facturation / clôture` après livraison si l'application doit couvrir le cycle concessionnaire complet.


## Audit complémentaire v21.89

### Défauts supplémentaires détectés et corrigés

1. **Contrôle qualité possible directement après démarrage travaux**

Dans un flux atelier/concessionnaire, le démarrage de production et la fin de production sont deux jalons différents. L’application passait de `Travaux en cours` à `Contrôle qualité`, ce qui pouvait laisser valider la qualité sans confirmation que le technicien a réellement terminé son intervention.

Correction : ajout du jalon `Travaux terminés`, avec historique `work.completed`, bouton dédié dans l’écran qualité, affichage dans le workflow et règle bloquante avant contrôle qualité.

2. **Livraison assurance sans preuve photo après réparation**

Pour un dossier assurance/carrosserie, la livraison doit conserver une preuve visuelle après réparation, utile pour le client, l’expert et l’archivage dossier.

Correction : la livraison est bloquée pour les ordres assurance tant qu’aucune photo catégorisée `Après réparation` n’est présente.

3. **Normalisation d’ordre avec propriété dupliquée**

La propriété `includeInPlanning` était déclarée deux fois lors de la normalisation d’un ordre de réparation.

Correction : suppression du doublon pour éviter les ambiguïtés de maintenance.

### Tests v21.89 ajoutés

- Vérification que le prochain jalon après `Démarrer travaux` est `Travaux terminés`.
- Vérification que le contrôle qualité refuse un dossier dont les travaux ne sont pas terminés.
- Vérification que la livraison assurance exige une photo `Après réparation`.

### Tests exécutés après correction

- `node tests/smoke.test.mjs`
- `node tests/estimate_regression.mjs`


## Audit complémentaire v21.90

### Défauts supplémentaires détectés et corrigés

1. **Accords possibles sur un devis sans main-d’œuvre réelle**

Le contrôle direct des champs d’accord regardait seulement la présence d’une ligne de devis. Un devis importé avec une ligne à `0 h` pouvait donc passer un accord expert ou client au niveau de l’ordre, puis être bloqué plus tard au RDV.

Correction : les validations d’accord et de statut utilisent maintenant `claimHasLaborEstimate()`, c’est-à-dire au moins une ligne avec une durée de main-d’œuvre strictement positive.

2. **Livraison insuffisamment protégée en cas de données importées incohérentes**

La livraison contrôlait surtout le contrôle qualité et, pour l’assurance, les photos après réparation. Si des données importées déclaraient `qualityApproved=true` sans réception, démarrage, fin travaux ou affectation atelier, l’étape livraison pouvait être considérée comme valide.

Correction : la livraison impose maintenant la séquence complète : RDV fixé, réception véhicule, travaux démarrés, travaux terminés, affectation atelier existante, contrôle qualité validé, et photo après réparation pour les dossiers assurance.

### Tests v21.90 ajoutés

- Refus de l’accord expert sur un devis avec uniquement `0 h` de main-d’œuvre.
- Refus de l’accord client sur un devis avec uniquement `0 h` de main-d’œuvre.
- Refus de livraison d’un dossier incohérent avec qualité importée mais sans réception ni affectation atelier.

### Tests exécutés après correction

- `node tests/smoke.test.mjs`
- `node tests/estimate_regression.mjs`
- `node --check` sur `app.js`, tous les fichiers `js/*.js` et `sw.js`.
