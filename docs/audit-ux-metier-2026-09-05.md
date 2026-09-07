# 1. Executive verdict

**NIMR-SAV possède un moteur atelier suffisamment riche pour être conservé, mais son expérience actuelle ne garantit pas encore une représentation simple et fidèle du parcours véhicule jusqu’à sa livraison.**

Le problème principal dépasse la densité des écrans. Plusieurs notions essentielles se confondent : véhicule planifié et véhicule en travaux, fin des travaux et fin du séjour, estimation de disponibilité et engagement client, absence de tâche active et disponibilité du technicien.

**Ma recommandation est de conserver le moteur, de réunifier les informations métier et de concentrer l’utilisation quotidienne autour d’Aujourd’hui.** La cible tient en quatre espaces communs, avec un seul espace d’exécution pour le technicien.

Trois sujets passent avant toute évolution esthétique :

1. **Fiabilité entre utilisateurs.** Les chemins de synchronisation automatique examinés exigent un droit absent des rôles Chef Atelier, Réception, Technicien et CQ.
2. **Présence physique et finalisation.** Un dossier peut être clôturé puis archivé sans CQ ni livraison confirmée ; la clôture peut le faire disparaître du suivi des véhicules présents.
3. **Autorisation des travaux et engagement client.** L’import d’un devis, la validation technique et l’accord du client doivent rester trois faits distincts.

**Périmètre et niveau de preuve.** L’audit porte sur la [copie `__github_publish_NIMR_SAV`](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html>), conformément à votre confirmation. La racine v22.19 et le prototype React sont exclus des notes. Le commit de référence est `bfaff47`, du 5 septembre 2026 ; le dossier de travail comporte également des modifications non commitées, dont une version déclarée v23.3.31. Leur présence empêche d’assimiler automatiquement ce dossier au build effectivement servi.

Le [site publié](https://irondrass.github.io/NIMR-SAV/) a été consulté, mais l’accès disponible s’arrête à la connexion. Les parcours internes, leurs clics et leurs limites sont donc **reconstitués à partir du code**, sauf mention contraire. Les mesures à 360, 390 et 430 px concernent la connexion ; l’analyse mobile interne repose sur le HTML, le CSS, les fonctions et les tests.

Quatre suites ciblées ont été exécutées avec succès. Cela confirme certains invariants ; cela ne constitue ni une recette complète ni une validation du fonctionnement multiutilisateur en production.

**Aucun fichier n’a été modifié pendant cette mission. Aucun SQL, changement Supabase, commit, push ou PR n’a été effectué.**

Dans la suite :

- **Fait** : comportement lu dans le code, assertion exécutée ou écran effectivement observé.
- **Déduction** : conséquence probable pour l’utilisation atelier.
- **Cible** : recommandation, à distinguer de l’existant.

# 2. Ce que NIMR-SAV fait déjà très bien

| Élément | Fait établi | Pourquoi le conserver |
|---|---|---|
| Opération métier identifiable | Le modèle canonique conserve identifiants, libellés et provenance des opérations. | Il permet d’expliquer ce qui doit être exécuté et d’où provient la demande. |
| Dépendances entre opérations | Le moteur et les tests couvrent séquences, embranchements, regroupements et opérations parallèles. | Ces contraintes ne doivent pas être réintroduites manuellement par le Chef. |
| Contraintes d’affectation | Les tests couvrent compétences, ressources indisponibles, équipements et affectations imposées. | Une UX plus simple ne doit pas produire un planning irréalisable. |
| Continuité des intervenants | Des préférences de continuité existent, avec distinction entre préférence et verrouillage. | Cela respecte la réalité d’un travail déjà engagé sans rigidifier toutes les affectations. |
| Pause et reliquat | Une interruption conserve le travail effectué et une reprise rattachée à la même tâche métier. | Le technicien peut retrouver une seule carte compréhensible malgré plusieurs objets techniques. |
| Isolation du technicien | La vue est limitée à ses tâches et les mutations contrôlent l’acteur courant. | C’est une bonne base pour la responsabilité individuelle. |
| Accueil selon le rôle | Chef et Réception arrivent sur Aujourd’hui ; Directeur sur Pilotage ; Technicien sur sa vue. | Cette simplification existe déjà. Il faut maintenant adapter le contenu. |
| MAINTENANT / ENSUITE | La vue technicien dispose déjà d’une opération prioritaire et d’une opération suivante. | Il faut alléger cette structure, pas la remplacer. |
| Import de devis | Les informations et la main-d’œuvre peuvent être récupérées depuis un PDF. | Cela réduit la ressaisie avec l’ERP. |
| Historique d’exécution | Démarrages, pauses, reprises, fins et interventions dérogatoires disposent de traces. | La simplicité doit conserver ces événements automatiquement. |
| Sauvegarde locale et synchronisation granulaire | L’architecture contient une file durable d’opérations et un traitement par entité. | Le principe convient à un atelier où le réseau peut être intermittent. |
| PWA | Cache applicatif, fonctionnement dégradé et proposition de mise à jour sont prévus. | Ce socle est utile sur téléphone et tablette. |

Les points structurants sont visibles dans [`deriveCanonicalPlanningTasks` et `getCasePlanningTasks`](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/business-rules-v2187.js:1051>), les [familles de tâches métier](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:1944>), les [gardes de mutation](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:2458>) et le [traitement granulaire de la synchronisation](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/supabase-sync.js:5066>).

Deux précisions évitent de proposer des travaux inutiles :

- Le technicien n’a déjà qu’une entrée principale.
- Le bandeau général de KPI est déjà masqué hors Pilotage.

**Le chantier porte surtout sur la cohérence métier, la hiérarchie et l’accès aux actions.**

# 3. Les causes principales de complexité

**1. La simplification a supprimé des distinctions métier indispensables.**

Réduire le nombre de boutons ne suffit pas. La distinction entre « travaux finis », « véhicule prêt » et « véhicule remis » reste nécessaire, même si elle tient dans deux actions très simples.

Le test du workflow simplifié protège explicitement la possibilité de clôturer sans étape qualité ou livraison. Il confirme que ce comportement est volontaire dans cette version, pas seulement un bouton oublié. [Test concerné](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/simplified_workflow_nimr_sav.test.mjs:517>).

**2. Plusieurs fonctions reconstruisent séparément la réalité du même dossier.**

`getCaseStatus`, les groupes Aujourd’hui, le suivi véhicule, les cartes technicien et les alertes Directeur n’utilisent pas exactement les mêmes critères.

Conséquence : un dossier peut être « En travaux » parce qu’il possède une affectation, alors que personne n’a démarré ; ailleurs, son activité dépend de `workStarted`.

**3. La navigation reflète encore l’organisation des modules.**

« Nouveau dossier », « Dossiers », « Aujourd’hui », « Technicien », « Planning » et « Atelier » donnent plusieurs portes vers des éléments du même séjour véhicule.

Le Chef doit comprendre où l’application a rangé l’action. Il devrait simplement reconnaître le véhicule et agir.

**4. L’information est souvent détaillée avant d’être hiérarchisée.**

La carte technicien montre simultanément durée, temps écoulé, début réel, fin estimée, technicien, ressource, zone et prochaine action. La ligne véhicule comporte douze cellules.

Ces informations sont parfois utiles, mais elles ne sont pas toutes utiles au même moment.

**5. Les droits techniques et les droits d’exécution sont mêlés.**

La synchronisation automatique ne devrait pas dépendre d’un droit d’exploitation réservé aux profils disposant de fonctions techniques. Une action métier autorisée doit pouvoir être transportée et confirmée, dans le respect des autorisations serveur.

**6. Des informations calculées sont présentées comme des faits acquis.**

Une réservation décrit une intention. Une estimation décrit une prévision. Une absence de tâche active décrit une observation limitée.

Aucune ne prouve, à elle seule, une intervention réelle, une heure promise au client ou une capacité immédiatement disponible.

**7. L’application demande encore de connaître son vocabulaire interne.**

Un nouvel utilisateur doit comprendre des différences telles que :

- dossier, ordre, devis et tâche ;
- tâche métier, réservation et reliquat ;
- terminé, clôturé et archivé ;
- durée prévue, temps travaillé et fin estimée ;
- sauvegarde locale, synchronisation et confirmation serveur.

Ces distinctions peuvent rester dans le moteur. Leur exposition doit être progressive et liée à une décision.

# 4. Les 20 principales frictions

Les fréquences et gains ci-dessous sont des **estimations opérationnelles**, pas des mesures effectuées dans votre atelier.

Effort : **1 = faible, 5 = élevé**. Impact : **1 = limité, 5 = majeur**. Le classement de sécurité reste prioritaire sur le ratio économique.

| ID | Friction et preuve | Sévérité | Fréquence estimée / rôles | Cause profonde | Solution minimale | Effort | Gain attendu | Impact / effort |
|---|---|---|---|---|---|---:|---|---:|
| F01 | La synchronisation automatique exige `supabase.sync.use`, absent des principaux rôles métier. [Droits](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:387>) · [Garde automatique](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/supabase-sync.js:1114>) | **Critique** | Chaque échange concerné ; Chef, Réception, Technicien, CQ | Confusion entre droit technique et transport des actions autorisées | Séparer transport automatique et commandes administratives ; vérifier chaque rôle jusqu’à l’accusé serveur | 3 | Rétablir la confiance entre postes | 5/3 = **1,67** |
| F02 | Clôture/archive sans CQ ni livraison ; exclusion du suivi actif après clôture. [Gardes](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:5346>) · [Filtre présence](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:2059>) | **Critique** | Chaque fin de séjour ; tous | Fin de production assimilée à fin du flux véhicule | Maintenir le véhicule présent jusqu’à remise effective ; finalisation courte CQ/Prêt/Livré | 2 | Aucun véhicule physiquement présent masqué | **2,50** |
| F03 | L’import crée un ordre `approved`, tandis que le démarrage ne vérifie pas un accord client explicite. [Création](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/app.js:479>) · [Démarrage](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:1998>) | **Critique** | Selon les travaux importés ; Réception, Chef | Devis importé, validation technique et autorisation confondus | Afficher et vérifier l’autorisation du périmètre exécuté, avec référence existante | 3 | Éviter une exécution dont l’autorisation n’est pas établie | **1,67** |
| F04 | ETA affichée sans sa réserve de fiabilité ; estimation réécrivant `appointment.delivery`. [Lecture ETA](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:2082>) · [Recalcul](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:4597>) | **Haute** | Plusieurs fois/jour ; Réception, Chef, Directeur | Prévision et engagement client mal séparés | Afficher ETA + fiabilité ; conserver séparément l’engagement communiqué | 2 | Réponse client cohérente, risques de retard visibles | **2,50** |
| F05 | « En travaux » peut signifier simplement reçu ou affecté. [Calcul du statut](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:619>) | **Haute** | Permanente ; tous | Une seule étiquette mélange phase, présence et activité | Une phase véhicule dérivée ; activité réelle issue des tâches démarrées | 2 | Lecture immédiate et compteurs fiables | **2,50** |
| F06 | Reprendre efface un blocage ; un blocage de tâche peut immobiliser le dossier entier. [Reprise](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:2441>) · [Déblocage](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:2553>) | **Haute** | À chaque incident ; Technicien, Chef | Blocage technique, cause métier et portée du blocage mêlés | Séparer reprise et résolution de cause ; conserver une portée tâche/dossier explicite | 3 | Moins de déblocages ambigus et d’arrêts inutiles | **1,33** |
| F07 | Aujourd’hui empile trois lectures ; un dossier peut apparaître dans plusieurs groupes et les blocages arrivent en dernier. [Groupes](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:1821>) · [Appartenances](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:3181>) | **Haute** | Permanente ; Chef, Réception | Construction par modules successifs | Une liste véhicule unique, exceptions d’abord, techniciens en vue complémentaire | 2 | Moins de balayage et de doubles comptages mentaux | **2,50** |
| F08 | Une action d’Aujourd’hui ouvre surtout Dossiers. [Gestion du clic](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:1844>) | **Moyenne** | Très fréquente ; Chef, Réception | Navigation utilisée à la place d’une action contextuelle | Exécuter l’action simple dans un panneau conservant le contexte | 2 | Éviter les allers-retours | **2,00** |
| F09 | « Sans tâche active » ne prouve pas la disponibilité ; la prochaine tâche est surtout choisie chronologiquement. [Carte technicien live](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:1922>) | **Haute** | Quotidienne ; Chef | État d’exécution utilisé comme mesure de capacité | Croiser horaires, absence, réservation et exécutabilité ; distinguer « prévue » et « exécutable » | 2 | Affectations plus sûres | **2,00** |
| F10 | L’import PDF regroupe les travaux par phase malgré un moteur capable de porter les opérations réelles. [Transformation PDF](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/app.js:408>) | **Haute** | Imports comportant plusieurs opérations ; Chef, Technicien | Agrégation trop précoce | Garder les opérations exécutables ; regrouper seulement les lots réellement indivisibles | 3 | Comprendre précisément le travail en cours | **1,33** |
| F11 | Nouveau dossier exige un devis PDF. [Formulaire](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html:134>) | **Haute** | Arrivée imprévue, diagnostic, dossier incomplet ; Réception | Point d’entrée construit autour du document | Autoriser un dossier minimal dans le même formulaire | 2 | Enregistrer immédiatement un véhicule sans fabriquer un devis | **2,00** |
| F12 | Chef : 7 entrées ; Directeur : 6 ; CQ reçoit Dossiers/Pilotage/Planning. [Navigation par rôle](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:5076>) | **Haute** | À chaque session ; Chef, Directeur, CQ | Masquage partiel sans workspace métier complet | Réduire les entrées visibles et spécialiser l’accueil | 1 | Réduire apprentissage et recherche du bon écran | **4,00** |
| F13 | La carte technicien expose huit blocs de métadonnées et des détails de provenance. [Carte actuelle](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:2628>) | **Moyenne** | Chaque consultation ; Technicien | Traçabilité confondue avec information primaire | Opération, véhicule, consigne, temps, action ; détails repliés | 1 | Compréhension plus rapide | **4,00** |
| F14 | Six actions peuvent occuper une barre horizontale ; chaque bouton fait au moins 124 px sous 430 px. [CSS mobile](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/styles.css:5443>) | **Haute** | Chaque tâche mobile ; Technicien | Même niveau visuel pour toutes les actions | Deux actions visibles et un accès secondaire, sans défilement horizontal | 1 | Accès fiable à une main | **4,00** |
| F15 | Fin de tâche : confirmation puis dialogue de note facultative ; blocage : deux dialogues. [Actions technicien](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:3027>) | **Moyenne** | Plusieurs fois/jour ; Technicien | Champs facultatifs transformés en étapes obligatoires | Un seul panneau par action, commentaire facultatif intégré | 1 | Une étape supprimée sur les parcours concernés | **4,00** |
| F16 | Une tâche affichée prête peut être refusée au démarrage pour indisponibilité, concurrence ou autre garde. [Gardes complètes](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/planning.js:1998>) | **Moyenne** | Aux situations contraintes ; Technicien | Affichage de disponibilité moins strict que la commande | Réutiliser les mêmes conditions pour l’étiquette et le bouton | 1 | Éviter les clics conduisant à un refus prévisible | **3,00** |
| F17 | Replanification par saisie `AAAA-MM-JJTHH:MM` ; fenêtre Gantt fixée à 08–17 h. [Replanification](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:6219>) · [Gantt](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-planning.js:39>) | **Moyenne** | À chaque déplacement ; Chef | Présentation proche du format technique | Choix d’heure normal et créneaux proposés ; fenêtre issue du calendrier atelier | 2 | Moins de saisie et meilleure correspondance au calendrier réel | **1,50** |
| F18 | Pilotage cumule indicateurs et synthèses ; un KPI ouvre une vue sans appliquer nécessairement son filtre. [KPI](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:508>) | **Moyenne** | Quotidienne ; Directeur | Dashboard informatif sans continuité de décision | Quatre indicateurs immédiats ; clic vers la population exacte | 1 | Lecture plus courte et contrôle explicable | **3,00** |
| F19 | État de synchronisation global, et accès aux conflits orienté vers une zone que certains rôles ne peuvent ouvrir. [Bandeau](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:1692>) · [Navigation conflits](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/app.js:1446>) | **Haute** | Hors ligne ou conflit ; tous | Diagnostic technique présenté sans responsable métier | Message contextualisé et responsable de résolution visible | 2 | Savoir si l’action est partagée et quoi faire | **2,00** |
| F20 | Fiche véhicule répétitive : cartes résumé, progression, réception, travaux, contrôles et actions dispersés. [Structure du détail](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html:1149>) | **Moyenne** | Chaque ouverture ; Chef, Réception | Accumulation de sections sans hiérarchie par décision | Un résumé opérationnel fixe et trois niveaux secondaires | 1 | Moins de scroll et de recherche | **3,00** |

**Classement strict Impact ÷ Complexité :**

- **4,00** : F12, F13, F14, F15.
- **3,00** : F16, F18, F20.
- **2,50** : F02, F04, F05, F07.
- **2,00** : F08, F09, F11, F19.
- **1,67** : F01, F03.
- **1,50** : F17.
- **1,33** : F06, F10.

**Ordre de décision recommandé :** traiter d’abord F01, F02 et F03, puis appliquer le classement économique. Un faible effort ne rend pas une amélioration visuelle plus urgente qu’une information véhicule potentiellement fausse.

Concernant F01, la conséquence en production reste à reproduire avec les rôles concernés. Le constat statique est cependant précis : `shouldAutoBackupToSupabase`, `autoBackupToSupabase` et `processOfflineQueue` passent par ce droit ; `hasPermission` utilise la table des rôles.

# 5. Analyse rôle par rôle

| Rôle | Situation actuelle | Test des 5 secondes | Accueil cible | Informations primaires | Actions primaires |
|---|---|---|---|---|---|
| Directeur SAV | Bon accueil sur Pilotage, mais empilement d’indicateurs et droits opérationnels très larges | **Partiel.** L’activité est visible ; savoir immédiatement si les engagements sont maîtrisés reste difficile | Pilotage | Engagements menacés, blocages nécessitant arbitrage, capacité, tendance | Arbitrer, attribuer une décision, consulter |
| Chef Atelier | Aujourd’hui est bien positionné, mais juxtapose plusieurs représentations et renvoie au dossier | **Non fiable.** Il doit encore chercher et interpréter | Aujourd’hui | Exceptions, véhicules présents, activité réelle, prochaine opération, disponibilité utile | Affecter, replanifier, traiter un blocage, demander une décision |
| Réception | Accueil commun avec le Chef ; dossier riche mais réponse client dispersée | **Non.** Promesse, ETA fiable, décision attendue et prochain contact ne forment pas une synthèse | Aujourd’hui orienté client | Motif, promesse, disponibilité probable, blocage formulable, prêt ou non | Recevoir, consigner un accord, informer, confirmer la remise |
| Technicien | Une seule vue, opération prioritaire et suivante déjà présentes | **Partiel, le plus proche de la cible.** Métadonnées, consignes répétées et actions concurrentes ralentissent | Aujourd’hui personnel | Une opération, un véhicule, une consigne, l’action permise | Démarrer, pause, reprendre, signaler, terminer |
| Garantie / Support | Pas de rôle canonique dédié identifié ; mécanismes dossier, historique et blocages disponibles | **Non démontré.** Pas de file d’accueil spécialisée active | Vue filtrée des véhicules nécessitant expertise | Question technique, faits, pièces utiles, décision attendue, échéance | Répondre, demander une précision, lever une attente dans son périmètre |
| CQ / Livraison | Droits qualité existants, mais accueil Dossiers et parcours qualité non raccordé à la navigation chargée | **Non.** La file « à contrôler » n’est pas son point d’entrée | Aujourd’hui filtré | Véhicules à contrôler, travaux concernés, anomalies ouvertes | Valider, retourner en atelier ; remise par Réception |

La [table des permissions](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:345>) distingue des droits, mais **un ensemble de droits ne constitue pas un workspace métier**.

**Directeur SAV.** Je ne lui retirerais pas automatiquement toutes ses prérogatives. Je rendrais les actions d’exploitation secondaires et réserverais l’écran d’accueil à ses décisions. Une capacité exceptionnelle d’intervention peut rester accessible et tracée.

Son test à 30 secondes doit aboutir à une phrase :

> « Deux sorties sont menacées, une décision m’attend, la mécanique est saturée demain et la carrosserie dispose de capacité. »

**Chef Atelier.** Il doit pouvoir traiter la majorité de ses arbitrages sans quitter Aujourd’hui. Ouvrir le dossier complet reste utile pour investiguer, pas pour affecter une opération déjà définie.

**Réception.** La question « que dire au client ? » doit avoir une réponse en une carte :

> « Remplacement en cours ; contrôle ensuite ; disponibilité estimée à 16 h 30, encore à confirmer ; nous avions annoncé 17 h ; rappel prévu à 15 h. »

Lorsque ces faits ne sont pas établis, l’interface doit le dire.

**Technicien.** Aucun KPI de gestion, aucune saisie commerciale et aucun choix de ressource sur son écran courant. Son propre nom ne mérite pas un grand bloc à chaque opération.

**Garantie / Support.** Une file filtrée suffit au départ. Un workspace séparé ne devient justifié que si un volume récurrent et des responsabilités distinctes sont constatés. Une nouvelle table ou un nouveau rôle ne résout pas, à lui seul, un problème de classement.

**CQ / Livraison.** Ce sont deux responsabilités à distinguer même si elles appartiennent à la même personne dans un petit atelier : autoriser la disponibilité technique et constater la remise physique.

**Test « aucune formation ».** Les termes à retirer du premier niveau sont notamment « reliquat », « override », « granularité », « conflit de synchronisation », « source MO » et les statuts hérités. Le rôle métier connaît une reprise, une dérogation motivée, une information non confirmée et une opération issue d’un devis.

# 6. Analyse écran par écran

Le tableau distingue les vues effectivement raccordées au shell et les modules présents dans le dépôt.

| Écran ou composant | Verdict | Décision |
|---|---|---|
| Connexion et récupération d’accès | **KEEP / SIMPLIFY** | Parcours standard. Agrandir le bouton principal selon la cible tactile et conserver des erreurs compréhensibles. |
| Navigation principale | **SIMPLIFY / HIDE BY ROLE** | Quatre espaces communs ; deux ou trois visibles pour la plupart des rôles. |
| Nouveau dossier / import PDF | **MERGE** | Faire de « Nouveau véhicule » une action de Véhicules/Aujourd’hui ; conserver l’import comme raccourci privilégié. |
| Six groupes Aujourd’hui | **MERGE** | Les remplacer par une population véhicule unique et des filtres d’exception. |
| Live Control Tower techniciens | **KEEP / SIMPLIFY** | Conserver la vue actuelle/suivante, corriger disponibilité et hiérarchie. |
| Tableau d’avancement véhicule | **KEEP / SIMPLIFY** | En faire le noyau d’Aujourd’hui ; réduire les douze colonnes et conserver les détails à l’ouverture. |
| Liste Dossiers | **KEEP / SIMPLIFY** | Renommer Véhicules côté utilisateur ; recherche immédiate plaque/VIN/client/OR. |
| Résumé du dossier | **MERGE** | Un résumé opérationnel commun remplace les cartes et progressions redondantes. |
| Réception physique | **KEEP / MERGE** | Une seule action contextualisée ; éviter sa répétition dans plusieurs panneaux. |
| Informations véhicule modifiables | **KEEP** | Le repli existant est pertinent ; champs conditionnels et corrections tracées. |
| Ordres, devis et main-d’œuvre | **KEEP / HIDE BY ROLE** | Indispensables au Chef et à la Réception ; provenance complète secondaire pour le technicien. |
| Photos | **KEEP / MERGE** | Ajouter depuis l’opération ou le constat ; galerie complète dans le dossier. |
| Planning du dossier | **KEEP / SIMPLIFY** | Voir les opérations et modifier une contrainte sans ouvrir toute l’administration. |
| Atelier du dossier | **MERGE** | Ses actions doivent être intégrées au résumé et à la finalisation. |
| Mes tâches / Technicien | **KEEP / SIMPLIFY** | Conserver MAINTENANT / ENSUITE ; réduire contenu et dialogues. |
| Planning général desktop | **KEEP / HIDE BY ROLE** | Chef en modification ; Directeur en consultation secondaire. |
| Liste planning mobile | **KEEP** | Plus appropriée qu’un Gantt réduit sur téléphone. |
| Pilotage | **SIMPLIFY / HIDE BY ROLE** | Directeur en premier ; synthèse de charge accessible au Chef si nécessaire. |
| Kanban/funnel général | **MERGE** | Vue secondaire de Pilotage si elle répond à une question différente ; supprimer sa répétition décorative. |
| Ressources, horaires, absences, sous-traitants | **KEEP / HIDE BY ROLE** | Paramétrage ou gestion ponctuelle ; l’absence du jour doit rester modifiable simplement par le responsable. |
| Utilisateurs et paramètres Supabase | **HIDE BY ROLE** | Administration technique secondaire. |
| Bandeau de synchronisation | **SIMPLIFY** | Message court en fonctionnement normal ; détails uniquement en anomalie. |
| Résolution des conflits | **KEEP / HIDE BY ROLE** | Conserver les protections, rendre la situation compréhensible pour les rôles non résolveurs. |
| Historique, impressions, exports | **KEEP / HIDE BY ROLE** | Disponibles depuis le dossier ou Pilotage, hors parcours principal. |
| Clôturer puis archiver | **REMOVE / AUTOMATE** | Supprimer cette séquence quotidienne au profit de finalisation puis remise physique. |
| Ancien workspace Réception à étapes | **REMOVE de la cible** | Réutiliser les données/fonctions utiles, pas réactiver toute la succession d’étapes. |
| Prototype React | **Hors périmètre** | Aucun motif démontré d’en faire le véhicule obligatoire de cette simplification. |

Le module [`ui-reception.js`](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-reception.js:281>) contient une succession d’étapes allant de la création à la livraison. Il n’apparaît pas dans la [liste de scripts chargés par l’index audité](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html:1455>). Il serait donc incorrect de le présenter comme le parcours actuel observé.

# 7. Architecture actuelle vs architecture cible

**Architecture actuelle, vue par l’utilisateur :**

```text
Nouveau dossier ── PDF
                       ┌─ Résumé / travaux
Dossiers ───────────────┼─ Photos
                       ├─ Planning
                       └─ Atelier / clôture / archive

Aujourd’hui ───────────┬─ 6 groupes
                       ├─ Techniciens live
                       └─ Avancement véhicules
                                  │
                                  └─ Retour vers Dossiers

Planning ────────────── Gantt + ressources + tâches
Technicien ──────────── Actuelle / suivante + détails + actions
Pilotage ────────────── KPI + charge + alertes + synthèses
Atelier ─────────────── Administration et configuration
```

**Architecture cible :**

```text
                   MÊMES FAITS MÉTIER
             présence · opérations · exécution
              blocages · ETA · CQ · livraison
                            │
       ┌────────────────────┼───────────────────┐
       │                    │                   │
  AUJOURD’HUI           VÉHICULES            PLANNING
  Agir maintenant       Comprendre un cas    Organiser la capacité
       │                    │                   │
       └─────────── même dossier contextuel ────┘
                            │
                         PILOTAGE
                 Décider et suivre les tendances

  Paramètres / utilisateurs / synchronisation : accès secondaire
  Technicien : Aujourd’hui personnel, une seule vue
```

La cible ne nécessite pas de réécrire le moteur ni de remplacer tous les objets existants. Elle nécessite une **lecture métier commune** utilisée par les vues et les gardes.

| Information | Source autoritaire cible | Règle de présentation |
|---|---|---|
| Présence véhicule | Événement de réception et événement de remise | Présent tant que reçu et non remis ; clôture administrative sans effet sur cette présence |
| Phase véhicule | Synthèse unique des événements et opérations | Même phase partout ; pas de sélection manuelle concurrente |
| Opération à réaliser | Tâche métier canonique, avec provenance | Libellé réel en premier |
| Opération en cours | Exécution démarrée, non terminée et non en pause | Une réservation future ne devient jamais du travail réel |
| Technicien intervenant | Affectation de l’exécution concernée et acteur enregistré | Distinguer prévu et réellement démarré |
| Horaire prévu | Réservation validée dans le calendrier atelier | Ne pas le remplacer par le temps réel |
| Temps réel | Sessions de travail et événements | Agréger la famille sans compter deux fois le reliquat |
| ETA | Calcul central existant et son état de fiabilité | Une estimation incertaine reste « à confirmer » |
| Engagement client | Dernier engagement effectivement communiqué et tracé | Ne jamais le réécrire automatiquement après replanification |
| Blocage | Cause ouverte, portée et responsable | Un seul message principal, détails accessibles |
| Accord | Autorisation du périmètre concerné et référence de preuve | Un import ne vaut pas accord |
| Pièces | Disponibilité/reservation confirmée par la source responsable | « Reprendre » ne prouve pas que la pièce est reçue |
| CQ | Décision qualité tracée et anomalies associées | Les indicateurs dérivés doivent suivre cette décision |
| Livraison | Remise physique confirmée par un acteur autorisé | Événement explicite |
| État partagé | Version confirmée par le serveur ; opérations locales signalées en attente | Distinguer « enregistré ici » et « partagé » |

**Répartition ERP / NIMR-SAV recommandée :**

| ERP / NAVISION | NIMR-SAV |
|---|---|
| Référentiel client et véhicule | Présence et séjour atelier |
| OR et devis commerciaux | Opérations exécutables et leur provenance |
| Prix, taxes, facturation, paiement | Affectations et capacité atelier |
| Commandes, stock, réservation de pièces | Blocage opérationnel dû aux pièces |
| Conditions et traitement financier de garantie | Question technique et attente de décision |
| Historique commercial | Historique d’exécution et contrôle |
| Documents contractuels | ETA, CQ, disponibilité et remise constatée |

L’import PDF constitue déjà une passerelle utile. Une connexion ERP plus ambitieuse ne se justifie qu’après avoir mesuré une ressaisie fréquente que cet import et les références existantes ne peuvent supprimer.

**Benchmark conceptuel :**

| Famille | Principe pertinent | Application à NIMR-SAV |
|---|---|---|
| DMS | Éviter la ressaisie du client, du véhicule et du travail commercial. [Keyloop](https://keyloop.com/blog/aftersales/what-to-look-for-workshop-management-software) | Réutiliser l’OR/devis ; ne pas recréer la facturation. |
| Workshop Management | Affecter selon compétences, disponibilité et capacité physique. [Keyloop](https://keyloop.com/blog/aftersales/what-to-look-for-workshop-management-software) | Conserver les contraintes du moteur, simplifier leur explication. |
| Maintenance de flotte | Relier véhicule, ordre et opérations ; proposer des vues filtrées et des détails repliables. [Fleetio](https://help.fleetio.com/en_US/work-order-overview) | Une fiche commune, plusieurs lectures adaptées au rôle. |
| Aviation Maintenance Control | Relier événement, ordre de travail et assistance technique ; retrouver les dossiers par filtres utiles. [Swiss-AS AMOS](https://www.swiss-as.com/public/training/AMOS%20Maintenance%20Control%20Part%201.pdf) | Une attente constructeur doit rester rattachée au problème du véhicule. |
| Field Service | Le tableau de planification sert au répartiteur pour voir disponibilités et réservations. [Microsoft](https://learn.microsoft.com/en-us/dynamics365/field-service/work-with-schedule-board) | Le Gantt sert au Chef ; il n’est pas l’écran du technicien. |
| Kanban opérationnel | Voir le flux et les écarts sans interpréter une collection d’indicateurs. [Lean Enterprise Institute](https://www.lean.org/the-lean-post/articles/are-computer-screens-okay-for-visual-management/) | Une carte par véhicule et une anomalie compréhensible. |
| Tour de contrôle de production | Faire ressortir l’écart au déroulement attendu et l’action nécessaire. Adaptation du même principe de management visuel. [Lean Enterprise Institute](https://www.lean.org/the-lean-post/articles/are-computer-screens-okay-for-visual-management/) | Exceptions, responsable, échéance et action avant les statistiques. |

Ce benchmark sert à extraire des principes. Il ne justifie ni une copie fonctionnelle de ces logiciels, ni leurs couches commerciales, ni les procédures documentaires propres à l’aéronautique.

# 8. Navigation cible minimale

**Quatre espaces principaux au niveau du produit :**

1. **Aujourd’hui**
2. **Véhicules**
3. **Planning**
4. **Pilotage**

**Administration reste un accès secondaire**, représenté par Paramètres et soumis aux droits nécessaires. « Nouveau dossier » devient une action, pas un cinquième espace.

| Rôle | Entrées principales visibles | Accueil |
|---|---|---|
| Directeur | Pilotage, Aujourd’hui, Véhicules | Pilotage |
| Chef | Aujourd’hui, Véhicules, Planning | Aujourd’hui |
| Réception | Aujourd’hui, Véhicules | Aujourd’hui orienté client |
| Technicien | Aujourd’hui personnel uniquement | MAINTENANT / ENSUITE |
| Garantie / Support | Aujourd’hui filtré, Véhicules autorisés | Décisions techniques attendues |
| CQ | Aujourd’hui filtré, Véhicules | À contrôler / retours |
| Administrateur technique | Accès selon besoin, paramètres en premier dans son travail technique | Paramètres ou dernier contexte |

Le Directeur peut consulter Planning depuis la charge ou un dossier sans que cet espace soit obligatoirement une entrée quotidienne.

**Trois filtres rapides suffisent dans Véhicules :** Présents, À venir, Historique. Les filtres métier complémentaires s’ouvrent à la demande. Le nombre de filtres visibles ne doit pas augmenter avec chaque nouvelle règle.

# 9. Today / Live Control Tower cible

Aujourd’hui doit devenir le poste de travail principal du Chef, avec une lecture différente pour la Réception.

**Ordre de lecture recommandé :**

```text
AUJOURD’HUI — samedi 5 septembre
Recherche véhicule / plaque / OR                 + Nouveau véhicule
Données partagées confirmées à 10:42

À TRAITER MAINTENANT — 3 véhicules
[Décision client] [Pièce manquante] [Sortie menacée]

PRÉSENTS À L’ATELIER — 18
6 en activité · 7 en attente · 3 en contrôle/préparation · 2 prêts

VÉHICULES
Priorité | Véhicule et motif | Maintenant → Ensuite | Disponibilité | Action

TECHNICIENS
[En activité] [En pause] [Sans tâche active] [Indisponibles]

À VENIR
Arrivées et opérations des prochaines heures
```

Les chiffres sont une maquette illustrative.

**Règles de composition :**

- Une seule population de véhicules présents.
- Une seule ligne par séjour véhicule dans cette population.
- Une exception regroupe ses causes sur le véhicule, plutôt que de multiplier les cartes.
- Les véhicules normaux restent visibles dans une liste sobre.
- Les véhicules prêts restent présents jusqu’à leur remise.
- Les arrivées futures restent séparées de la présence physique.
- Les tâches en pause ne gonflent pas le nombre de techniciens réellement en activité.
- Une recherche conserve le contexte et le filtre courant.

Les quatre nombres de présence doivent être issus de catégories exclusives. Les compteurs d’exception sont des filtres transversaux : **ils ne s’additionnent pas aux catégories de présence**.

**Actions possibles sans changement d’espace :**

| Situation | Action dans Aujourd’hui |
|---|---|
| Véhicule arrivé | Confirmer réception |
| Travaux validés sans affectation | Voir les créneaux proposés et affecter |
| Technicien absent | Déclarer l’indisponibilité puis voir les opérations affectées |
| Pièce attendue | Voir cause, responsable et échéance |
| Client doit décider | Ouvrir le panneau d’accord du dossier |
| Sortie menacée | Voir ce qui change et décider d’un nouvel engagement |
| Travaux terminés | Ouvrir la finalisation |
| Véhicule prêt | Informer le client ou confirmer la remise |

Les actions complexes ouvrent un panneau du même dossier. Le Gantt complet reste disponible pour les arbitrages qui le nécessitent.

**Le Directeur ne doit pas recevoir toute cette surface en accueil.** Il voit les décisions qui lui appartiennent, les engagements menacés et la capacité globale.

# 10. Carte véhicule cible

**Maquette d’un véhicule normal :**

```text
123 TU 4567 · NIMR X
Remplacement alternateur — témoin de charge allumé

EN INTERVENTION
Maintenant : remplacement alternateur · Ahmed
Ensuite    : contrôle de charge, puis préparation

Présent depuis 08:15
Disponibilité estimée : 15:30 — estimation confirmée
Promis au client      : 16:00

[Voir le dossier]                         […]
```

**Maquette d’un véhicule nécessitant une décision :**

```text
456 TU 8910 · NIMR Y
Bruit au freinage

À PRÉPARER
Attente accord client pour remplacement disques

Décision attendue de : Réception
À traiter avant     : 11:30
Impact              : sortie promise à 17:00 menacée

Disponibilité estimée : à confirmer — accord manquant

[Consigner la décision]                   [Détails]
```

**Hiérarchie exacte :**

1. Immatriculation et véhicule.
2. Motif concret du séjour.
3. Une phase.
4. Opération réelle et intervenant.
5. Prochaine opération.
6. Exception éventuelle avec responsable.
7. ETA et engagement client clairement nommés.
8. Une action pertinente.

**Éléments secondaires :** VIN complet lorsque la plaque suffit, détails du client pour le Chef, références multiples, lignes sources du devis, historique, pièces jointes et données administratives.

**Emplacement physique :** les champs de ressource ou de zone planifiée ne prouvent pas où se trouve réellement la voiture. La carte doit afficher « Présent à l’atelier » et, si disponible, le dernier emplacement confirmé. Un emplacement inconnu doit rester inconnu.

Je ne recommande pas d’ajouter une saisie obligatoire à chaque mouvement. Une confirmation d’emplacement ne se justifie que pour un besoin réel de localisation, avec réutilisation des informations existantes lorsque possible.

**Opérations parallèles :** si deux opérations sont réellement actives, afficher les deux ou « +1 opération active ». Ne pas résumer artificiellement le véhicule à un seul technicien.

# 11. Carte technicien cible

**Vue du Chef :**

```text
AHMED · Mécanique

EN ACTIVITÉ
Remplacement alternateur
123 TU 4567 · NIMR X

Depuis 09:20 · 45 min de travail enregistré
Ensuite : contrôle de charge — même véhicule

[Voir l’opération]
```

**Sans tâche active :**

```text
SAMI · Carrosserie

SANS TÂCHE ACTIVE
Disponible jusqu’à 11:30 selon le calendrier
Prochaine opération prévue à 11:30

[Voir les opérations affectables]
```

**Indisponible :**

```text
SAMI · Carrosserie

INDISPONIBLE JUSQU’À 14:00
2 opérations prévues sont concernées

[Réaffecter]
```

La seconde carte ne doit apparaître que si le calendrier, les absences et les réservations permettent réellement cette conclusion.

**Vue personnelle du technicien :**

```text
MAINTENANT

Remplacer l’alternateur
123 TU 4567 · NIMR X
Consigne : contrôler le câble de charge avant remplacement.

EN COURS · 45 min

[Pause]                    [Terminer]
                 [Signaler un problème]

ENSUITE
Contrôler la charge — même véhicule

[Détails / note / photo]
```

La traçabilité source reste accessible. Elle ne doit pas occuper autant de place que la consigne de travail.

# 12. Workflow cible arrivée → livraison

**Six phases visibles suffisent**, avec une réservation et des exceptions décrites séparément.

```text
ATTENDU
   │ réception physique
   ▼
À PRÉPARER
   │ première opération autorisée démarrée
   ▼
EN INTERVENTION
   │ toutes les opérations requises terminées
   ▼
À FINALISER
   │ CQ / essai / préparation applicables validés
   ▼
PRÊT
   │ remise physique confirmée
   ▼
LIVRÉ
```

Les libellés secondaires rendent « À finaliser » concret : **CQ à faire**, **essai requis**, **préparation en cours**.

| Transition | Responsable normal | Conditions essentielles | Automatisation utile |
|---|---|---|---|
| Création → Attendu | Réception | Identifier le véhicule et le motif ; date facultative si non convenue | Import et préremplissage |
| Attendu → À préparer | Réception | Présence physique confirmée | Horodatage et acteur |
| À préparer → En intervention | Technicien affecté | Périmètre autorisé, prérequis, ressource, pièces nécessaires | Phase déduite du premier démarrage |
| En intervention → À finaliser | Système après dernière fin valide | Toutes les tâches métier requises et reliquats terminés | Pas de bouton global supplémentaire en fonctionnement normal |
| À finaliser → En intervention | CQ / Chef | Anomalie identifiée et travail correctif défini | Retour visible avec motif ; historique conservé |
| À finaliser → Prêt | CQ ou personne habilitée | Contrôles applicables satisfaits, aucun retour ouvert | Date et auteur de validation |
| Prêt → Livré | Réception | Remise effective et autorisation de remise selon procédure interne | Historique et retrait des présents |

**Les étapes intermédiaires restent des décisions ou des propriétés :**

- diagnostic : une opération ;
- accord client : une condition du périmètre concerné ;
- attente constructeur : une exception attribuée ;
- pièces : une disponibilité ou une cause de blocage ;
- planification : un engagement de ressources ;
- appel client : un événement de contact ;
- archivage : une organisation de l’historique.

**Cas à ne pas enfermer dans une fausse séquence :**

- Véhicule reçu sans rendez-vous : création et réception immédiates.
- Diagnostic sans réparation autorisée : sortie documentée « remis sans réparation », sans inventer des travaux terminés.
- Travaux additionnels : accord sur le supplément, sans remettre en attente tout ce qui reste autorisé.
- Retouche après CQ : retour sur les opérations nécessaires, sans effacer l’exécution initiale.
- Absence au rendez-vous : traitement du rendez-vous, sans créer une présence fictive.

Cette cible ajoute surtout des **gardes de finalisation** à des données déjà présentes. Elle ne justifie pas de réactiver un parcours à onze écrans.

# 13. Statuts à supprimer / fusionner / conserver

Le référentiel actuel contient déjà six statuts principaux. **Le problème est leur signification et leur calcul, davantage que leur nombre.** [Définitions et alias](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/state.js:504>).

| État actuel ou implicite | Décision | Représentation cible |
|---|---|---|
| `chief_validation` | Retirer comme phase véhicule | « Travaux à valider » dans les actions, sur Attendu ou À préparer |
| `planning` / À planifier | Retirer comme phase globale | « Non planifié » comme propriété des opérations |
| `in_progress` / En travaux | Conserver le sens, corriger le calcul | En intervention uniquement après démarrage réel |
| `completed` / Travaux terminés | Fusionner avec la transition de finalisation | À finaliser |
| `closed` / Atelier clôturé | Retirer du flux visible quotidien | Ne détermine ni présence, ni disponibilité, ni livraison |
| `archived` | Retirer des phases opérationnelles | Historique / archivage secondaire |
| RDV planifié | Conserver comme donnée de rendez-vous | Attendu — RDV à 08:30 |
| Reçu | Conserver comme événement | À préparer ou phase ultérieure ; véhicule présent |
| Attente client / expert / interne | Conserver comme cause | Exception avec responsable et échéance |
| Bloqué | Retirer comme phase exclusive | Indication sur la phase concernée |
| Attente pièces | Conserver comme cause | « En attente — pièce prévue demain » |
| CQ non commencé / en cours | Réduire l’exposition | À finaliser — CQ à faire / en cours |
| CQ refusé / retouche | Conserver la décision | Retour en intervention avec anomalie |
| CQ validé | Conserver comme preuve | Condition de Prêt |
| Prêt | Rendre explicite | Travaux et finalisation satisfaits, véhicule encore présent |
| Livré | Rendre explicite | Remise effective |
| Facturé | Sortir du statut atelier | Information ERP secondaire |

Les deux tables d’alias actuelles ne donnent pas toujours la même correspondance à des états historiques. Elles doivent être réconciliées avant de considérer un simple changement de libellé comme suffisant.

**Pour les tâches : quatre états de cycle de vie suffisent.**

| Cycle de vie cible | Précision dérivée |
|---|---|
| À faire | Exécutable, prévue plus tard ou en attente d’un prérequis |
| En cours | Travail effectivement démarré |
| En pause | Motif et condition de reprise |
| Terminée | Famille métier complète |

« Bloquée » reste une cause visible. « Prête à démarrer » doit employer les mêmes conditions que la commande de démarrage.

**Ce nombre de libellés n’impose pas de nouveaux statuts stockés.** Une première simplification peut être une projection commune des données existantes, accompagnée des corrections indispensables des gardes.

# 14. Actions par rôle

L’administrateur technique conserve les capacités nécessaires au support, mais n’est pas inclus comme opérateur quotidien.

| Action | Capacité actuelle dans le code | Responsable cible | Autres interventions admises |
|---|---|---|---|
| Créer/importer un dossier | Réception, Chef, Directeur | Réception | Chef si arrivée atelier directe |
| Confirmer réception | Réception, Chef, Directeur | Réception | Chef en remplacement |
| Valider les travaux importés | Parcours de validation Chef | Chef | Directeur par délégation |
| Consigner l’accord client | Logiques et données héritées, parcours principal incomplet | Réception | Responsable explicitement habilité |
| Affecter/replanifier | Chef, Directeur | Chef | Directeur pour arbitrage exceptionnel |
| Déclarer une absence opérationnelle | Profils de gestion des ressources | Chef | Administration selon organisation |
| Démarrer/pause/reprendre/terminer | Technicien sur ses tâches ; profils de supervision | Technicien affecté | Chef avec dérogation tracée si nécessaire |
| Signaler un blocage | Technicien et supervision | Celui qui constate | Chef qualifie portée et priorité |
| Résoudre attente client | Pas suffisamment distingué de la reprise technique | Réception | Responsable de la décision |
| Résoudre attente constructeur | Pas de rôle dédié | Support/garantie habilité | Chef |
| Valider/refuser CQ | Droits Chef, Directeur, CQ | CQ ou personne habilitée | Chef selon procédure |
| Confirmer la remise | Droits Réception, Chef, Directeur ; parcours principal incomplet | Réception | Remplaçant autorisé |
| Clôturer/archive | Chef, Directeur | Automatisation de classement après événement approprié | Correction administrative exceptionnelle |
| Résoudre conflit serveur | Contrôles techniques spécifiques | Superviseur habilité | Administration technique |

**Audit des interactions.** Les valeurs actuelles suivantes sont des parcours minimaux reconstruits depuis le code, depuis l’écran contenant l’action. Elles n’incluent pas le déverrouillage du téléphone ni les gestes propres au sélecteur de fichier de l’OS.

| Action | Actuel | Cible | Information nécessaire avant | Feedback nécessaire après | Risque à maîtriser |
|---|---:|---:|---|---|---|
| Ouvrir un véhicule depuis Aujourd’hui | 1 clic, mais changement d’espace | 1 | Identité et motif | Panneau avec contexte conservé | Mauvais dossier sélectionné |
| Démarrer | 1 | 1 | Opération, véhicule, prérequis | En cours, heure, enregistrement local/partagé | Démarrage sur mauvais véhicule |
| Pause | Action + choix du motif + validation ; gestes variables du sélecteur | 2–3 | Motif court | Pause effective, temps préservé | « Attente pièce » choisi par défaut à tort |
| Reprendre | 1 | 1 si pause simple ; 2 si résolution nécessaire | Cause levée ou condition satisfaite | Reprise et acteur | Effacer une cause encore réelle |
| Bloquer | 3 activations minimales avec motif par défaut, davantage pour changer le choix | 2–3 | Motif ; détail seulement si nécessaire | Responsable et impact visibles | Bloquer tout le dossier inutilement |
| Terminer | 3 : bouton, confirmation, validation du dialogue de note | 2 | Bonne opération, travail achevé | Fin, temps, opération suivante | Fin accidentelle |
| Note libre | 3 activations minimales via les deux dialogues | 2 | Observation | Note horodatée dans l’opération | Information non rattachée |
| Photo | Action + interface appareil/fichier | Parcours appareil minimal | Véhicule/opération préattachés | Photo enregistrée ou en attente | Croire la photo partagée alors qu’elle reste locale |
| Replanifier | 2 activations depuis l’action, plus saisie d’une date technique | 2–3 | Contrainte souhaitée et impact | Créneau réellement obtenu | Confondre heure demandée et heure retenue |
| Valider CQ | Parcours principal raccordé non établi | 2 | Travaux, anomalies et contrôles applicables | Prêt ou retour atelier motivé | Validation sans contrôle effectué |
| Confirmer remise | Parcours principal raccordé non établi | 2 | Identité du véhicule et autorisation de remise | Livré, heure, auteur | Sortie déclarée trop tôt |

Le parcours technicien est explicite dans [`handleTechnicianTaskAction`](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:3009>). La replanification utilise actuellement un [`window.prompt` avec format technique](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/js/ui-cases.js:6219>).

**Saisie : traitement recommandé champ par champ.**

| Champ ou saisie | Traitement cible |
|---|---|
| Client, véhicule, plaque, VIN, téléphone | Préremplir depuis la source existante ; ne demander que les manquants utiles |
| OR et référence devis | Importer ; ne pas les retaper dans chaque opération |
| Propriétaire / déposant / téléphone déposant | Montrer seulement si différent de l’interlocuteur principal |
| Assurance | Conditionnel aux dossiers concernés |
| Kilométrage | Une observation réelle à l’arrivée ; ne pas déduire une valeur actuelle d’un ancien dossier |
| Motif de visite | Une phrase conservée ; ne pas confondre demande client et opération proposée |
| État à l’arrivée / dégâts | Une zone de constat cohérente, avec photos facultatives ; éviter deux récits identiques |
| Libellé d’opération | Reprendre l’opération réelle et la ligne source ; corriger une fois |
| Phase métier | Déduire ; faire confirmer les classifications incertaines au Chef |
| Durée prévue | Importer/calculer ; correction justifiée, sans double saisie |
| Technicien et équipement | Proposer selon le moteur ; choix manuel seulement lorsqu’utile |
| Début, fin, auteur | Enregistrer automatiquement à l’action |
| Temps travaillé | Calculer depuis les sessions ; correction exceptionnelle tracée |
| Cause de pause | Boutons courts ; aucun motif métier sensible précoché par défaut |
| Détail de blocage | Facultatif, sauf motif « autre » ou besoin d’explication |
| Note et photo | Facultatives, attachées automatiquement au dossier et à l’opération |
| Pièces | Réutiliser le fait confirmé ; ne pas demander au technicien de reproduire le stock ERP |
| Accord | Enregistrer une fois le périmètre et la référence ; ne pas inventer l’accord |
| ETA | Calcul automatique, avec réserve de fiabilité |
| Engagement client | Enregistrement explicite quand il est communiqué ; ce fait ne peut pas être déduit du planning |
| Prochain contact | Déduire de l’événement à suivre ; saisir une heure seulement lorsqu’elle a été promise |
| CQ | Deux résultats simples : conforme ou retour ; commentaire conditionnel en cas d’écart |
| Archive | Aucun clic quotidien après livraison si le classement peut être automatique |

Les champs existants de l’import et de l’identité offrent déjà une bonne partie de cette matière. [Import](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html:166>) · [Identité et arrivée](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/index.html:1198>).

# 15. Management by exception

**Oui, cette philosophie convient à NIMR-SAV**, à condition que l’exception signale un écart réel et une décision attribuable.

Aujourd’hui, les règles sont dispersées. Une validation ou une information incomplète peut rejoindre le groupe « retard » par défaut ; certaines situations normales de fin de parcours deviennent des alertes importantes.

Je recommande les règles initiales suivantes. **Les seuils chiffrés sont des paramètres proposés pour recette, pas des normes métier établies.**

| Niveau | Règle exacte proposée | Responsable | Action |
|---|---|---|---|
| Rouge | Engagement client dépassé et véhicule non remis | Réception + Chef | Confirmer la situation et informer le client |
| Rouge | ETA exploitable postérieure à l’engagement client | Chef | Arbitrer le planning et faire réviser la promesse si nécessaire |
| Rouge | Travail engagé sur un périmètre dont l’autorisation est absente ou refusée | Chef + Réception | Arrêter le périmètre concerné et clarifier l’accord |
| Rouge | CQ refusé avec anomalie empêchant la mise à disposition | CQ + Chef | Retour atelier ciblé |
| Rouge | Ressource affectée absente/indisponible alors que l’opération devrait être en cours | Chef | Réaffecter ou replanifier |
| Rouge | Conflit de données empêchant une action immédiate sur ce véhicule | Superviseur habilité | Résoudre le conflit ; opérateur informé |
| Orange | Marge entre ETA et engagement inférieure à 30 minutes, sans dépassement établi | Chef | Examiner la sortie |
| Orange | Début prévu dépassé de 15 minutes ouvrées, tâche exécutable et non démarrée | Chef | Démarrer, réaffecter ou expliquer |
| Orange | Véhicule présent sans activité, sans attente justifiée et sans prochaine opération planifiée depuis 30 minutes ouvrées | Chef | Organiser la suite |
| Orange | Temps de travail réel supérieur au prévu de `max(15 min, 20 % du prévu)` | Chef / Technicien | Demander une estimation du reste ou une aide |
| Orange | Pièce nécessaire non disponible avant le début requis | Responsable pièces + Chef | Confirmer une date et revoir le plan |
| Orange | Décision client/constructeur échue ou empêchant la prochaine opération | Réception / Support | Relancer ou décider |
| Orange | Sortie prévue aujourd’hui, ETA à confirmer et contrôle restant non positionné | Chef + Réception | Fiabiliser la disponibilité avant de promettre |
| Orange | Véhicule prêt mais contact client attendu non effectué à l’échéance convenue | Réception | Contacter et tracer |
| Neutre | Travail dans les limites prévues | Aucun | Aucune alerte |
| Neutre | Pause prévue, pièce attendue à temps ou décision dont l’échéance reste compatible | Responsable connu | Suivi discret |

**Règles de fonctionnement :**

- Les délais opérationnels utilisent les heures d’ouverture.
- Une seule exception principale par véhicule ; les causes secondaires restent accessibles.
- Chaque exception comporte **un responsable, une échéance et une action**.
- Le rouge signifie « intervenir maintenant », pas simplement « cette donnée est importante ».
- Une correction de cause ferme l’exception ; un bouton « vu » ne la résout pas.
- Le Directeur ne reçoit que les arbitrages qui lui appartiennent et les engagements significativement menacés.
- Une absence d’ETA produit « estimation à confirmer », pas une fausse précision.
- Aucune multiplication de notifications à chaque recalcul.
- La couleur est accompagnée d’un libellé ; elle n’est jamais le seul signal.

Le système peut dériver l’essentiel de ces exceptions à partir des données existantes. Il n’a pas besoin d’un moteur de workflow supplémentaire ni d’une table par type d’alerte.

# 16. Simplification du planning

| Le moteur conserve | L’utilisateur voit |
|---|---|
| Dépendances et opérations parallèles | « Diagnostic nécessaire avant remplacement » |
| Compétences et métiers | Techniciens compatibles |
| Ressources humaines et équipements | Créneaux réellement possibles |
| Affectations imposées | « Ahmed conservé sur cette opération » |
| Préférences de continuité | Proposition cohérente, modifiable lorsque permis |
| Horaires, fermetures et absences | Disponibilité utilisable |
| Segments techniques et reliquats | Une opération et son reste à faire |
| Arbitrage de capacité | Impact sur la fin du dossier |
| Réservation atomique | Affectation confirmée ou refus explicable |
| Historique prévu/réel | Ce qui a changé, pourquoi et par qui |

**Parcours cible d’affectation :**

1. Le Chef sélectionne une opération à organiser.
2. Le système présente le premier créneau possible et quelques alternatives réellement différentes.
3. Le Chef confirme ou impose une contrainte simple.

La contrainte s’exprime en langage courant :

- « À partir de demain matin » ;
- « Conserver Ahmed » ;
- « Véhicule prioritaire avant 16 h » ;
- « Cabine indisponible cet après-midi ».

L’utilisateur ne doit pas modifier des dépendances ou des identifiants techniques pour effectuer ces choix.

**Gantt :** à conserver pour le Chef sur desktop. Il aide à arbitrer des ressources simultanées et à comprendre la charge. Il ne doit pas devenir obligatoire pour recevoir un véhicule, répondre au client ou démarrer une tâche.

**Timeline véhicule :** utile dans le dossier, sous forme de quelques opérations ordonnées. Les dépendances complexes restent repliées.

**Drag & drop :** pas prioritaire. Le parcours de replanification actuel mérite d’abord un sélecteur lisible et un aperçu du résultat. Un glisser-déposer ajoute validation, gestion des conflits, accessibilité clavier et gestes tactiles ; sa valeur doit être démontrée par des déplacements fréquents sur desktop.

**Ce qui reste manuel :**

- priorité décidée ;
- absence ou indisponibilité réelle ;
- affectation imposée ;
- date promise au client ;
- décision exceptionnelle et motif.

**Ce qui doit rester automatique :**

- recherche des créneaux ;
- vérification des dépendances ;
- recalcul des conséquences ;
- agrégation des reliquats ;
- calcul de l’ETA et de sa fiabilité.

**Ce qui ne doit pas être automatique sans arbitrage :** déplacer silencieusement du travail déjà engagé ou changer un engagement communiqué au client.

La distinction entre préférence de continuité et affectation dure est particulièrement bien protégée par les [tests d’affectation et de continuité](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/graph_continuity_assignment_locks_p1006.test.mjs>).

# 17. Simplification mobile technicien

**Résultat des vérifications disponibles :**

| Largeur | Connexion observée | Vue interne déduite du CSS |
|---:|---|---|
| 360 px | Pas de débordement horizontal mesuré ; champs de 44 px ; bouton de connexion de 42 px | Métadonnées en une colonne ; barre d’actions trop large pour afficher six boutons ensemble |
| 390 px | Même résultat de structure et de hauteur | Même problème de hiérarchie et de barre horizontale |
| 430 px | Même résultat de structure et de hauteur | Le seuil CSS conserve une colonne de métadonnées et des boutons d’au moins 124 px |

Les tests mobiles du dépôt comprennent des profils 360/390/430. Une simulation Chromium portant un nom d’iPhone ne constitue pas une vérification Safari réelle. Je ne conclus donc pas à une compatibilité iOS complète.

**Écran cible concret :**

- Marge latérale de 16 px.
- Opération en premier, sur deux lignes si nécessaire.
- Plaque et modèle immédiatement dessous.
- Consigne utile, sans troncature qui ferait perdre une instruction importante.
- État et temps sur une ligne.
- Deux boutons d’action de **56 px de hauteur**.
- Une action « Signaler un problème » identifiable.
- ENSUITE visible avant les informations administratives.
- Détails, historique, note et photo repliés.
- Aucun défilement horizontal pour agir.
- Barre basse compatible avec la zone de sécurité et le clavier.

**Actions selon l’état :**

| État | Actions visibles | Secondaire |
|---|---|---|
| À faire et exécutable | Démarrer | Consigne, note/photo |
| À faire mais empêché | Cause et responsable | Voir le prérequis |
| En cours | Pause, Terminer | Signaler problème, note/photo |
| En pause simple | Reprendre | Modifier le motif si erreur |
| Bloqué | Voir/résoudre la cause selon droit | Note/photo |
| Terminé | Voir la suivante | Historique |

**Pause et blocage.** Un seul panneau propose des motifs courts. « Pause personnelle », « Attente pièce », « Attente décision », « Difficulté technique » ne doivent pas être interchangeables.

**Fin de tâche.** Un panneau unique :

```text
Terminer « Remplacer l’alternateur » ?
123 TU 4567

Note facultative : [Ajouter une note]

[Continuer le travail]      [Terminer]
```

**Synchronisation.** Une formulation courte suffit :

- « Enregistré sur cet appareil — partage en attente » ;
- « Partagé à 10:42 » ;
- « Action non partagée — prévenir le Chef ».

La connexion réseau seule ne prouve pas que l’action est confirmée par le serveur.

**Test terrain à effectuer lors de la future recette :** un technicien nouvellement connecté identifie son véhicule, son opération et son bouton en moins de cinq secondes, puis réalise démarrage, pause et fin à une main, sans ouvrir le planning.

Le fait que les boutons soient grands ne suffit pas à réussir ce test. La densité et la stabilité de leur position comptent autant.

# 18. Ce qu’il faut supprimer

**À supprimer du premier niveau :**

1. L’entrée principale « Nouveau dossier ».
2. La présence simultanée de trois représentations complètes dans Aujourd’hui.
3. Les occurrences multiples du même véhicule dans les groupes opérationnels.
4. Les boutons « Clôturer atelier » puis « Archiver » comme fin quotidienne normale.
5. Les étapes obligatoires contenant seulement une note facultative.
6. Le nom du technicien dans un grand bloc sur sa propre carte.
7. L’impression parmi les actions primaires du technicien.
8. Les détails complets de provenance MO en lecture initiale.
9. Les messages « Aucun blocage » répétés sur tous les véhicules normaux.
10. Les KPI qui ne conduisent ni à une décision ni à une population identifiable.
11. Les liens KPI qui ouvrent une liste non filtrée.
12. La saisie d’une date de replanification dans un format technique.
13. Les statuts hérités et leurs synonymes visibles.
14. Les progressions concurrentes du même dossier.
15. Les actions de réception répétées dans plusieurs sections.
16. Les commandes techniques de synchronisation sur les écrans des opérateurs.
17. L’équivalence implicite entre validation de devis, accord et autorisation de travailler.
18. L’équivalence entre « sans tâche active » et « disponible ».
19. L’affichage d’une heure de fin précise lorsque la cause de blocage la rend indéterminable.
20. Tout projet de workspace Garantie autonome avant de démontrer qu’une file filtrée est insuffisante.

**À supprimer comme comportement :**

- faire disparaître un véhicule présent après une clôture administrative ;
- réécrire l’engagement client lors d’un recalcul ;
- faire passer une affectation pour une intervention réelle ;
- effacer implicitement une cause métier à la reprise ;
- proposer un bouton dont le refus est déjà prévisible.

Il s’agit souvent de retirer une exposition ou une redondance, pas de détruire l’historique ou les fonctions internes utiles.

# 19. Ce qu’il ne faut surtout pas casser

| Invariant | Protection attendue pendant la simplification |
|---|---|
| Identité stable de l’opération | Même tâche métier à travers import, proposition, réservation, reprise et rechargement |
| Provenance | Retrouver la ligne ou le groupe source sans inventer une origine aux anciens dossiers |
| Montant de travail prévu | Conserver les durées autoritaires et éviter les doubles comptes |
| Dépendances | Aucun démarrage anticipé d’une opération réellement dépendante |
| Parallélisme | Ne pas sérialiser artificiellement des opérations indépendantes |
| Exclusivité véhicule | Ne pas la confondre avec le simple caractère parallélisable |
| Affectation dure | Aucun remplacement silencieux si la ressource imposée devient incompatible |
| Continuité souple | Préférer le même intervenant sans transformer toute préférence en interdiction |
| Couple humain/équipement | Réserver les ressources nécessaires ensemble |
| Travail engagé | Ne pas le réaffecter silencieusement lors d’un recalcul |
| Pause/reprise | Préserver temps travaillé, reste et historique |
| Carte unique | Un reliquat technique ne doit pas apparaître comme une seconde opération métier |
| Fin de famille | Le dossier n’est terminé que lorsque toutes les opérations requises le sont |
| Autorisation de mutation | L’acteur courant et l’appartenance de la tâche doivent rester contrôlés |
| Dérogation | Motif, auteur et événement distincts |
| Mode hors ligne | Une action locale reste traçable jusqu’à confirmation ou résolution |
| Synchronisation | Idempotence, conflits explicites, ordre cohérent des opérations |
| Réservation concurrente | Confirmation atomique, sans double réservation silencieuse |
| Historique | Aucun effacement pour simplifier visuellement une fiche |
| Photos | Facultatives par défaut, sauf règle métier explicitement applicable |

**Vérifications exécutées :**

| Suite | Résultat | Portée |
|---|---|---|
| [Workflow simplifié](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/simplified_workflow_nimr_sav.test.mjs>) | Passée | Comportements du flux actuel, dont certaines décisions métier critiquées |
| [Modèle canonique](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/canonical_task_model_p1003.test.mjs>) | Passée, 15 scénarios annoncés | Identités, provenance, dépendances et transformation des opérations |
| [Continuité et verrouillages](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/graph_continuity_assignment_locks_p1006.test.mjs>) | Passée, 26 scénarios annoncés | Contraintes, préférences et préservation des affectations |
| [Pause et reliquat technicien](<C:/Users/mhadh/Desktop/NIMR CARROSSERIE V2/__github_publish_NIMR_SAV/tests/technician_pause_remainder_v2227.test.mjs>) | Passée | Une carte, reprise, temps et clôture de la famille |

**Un test passant n’est pas une validation du choix produit.** L’assertion qui autorise la clôture sans qualité/livraison devra évoluer si le flux cible est adopté. À l’inverse, les tests d’identité, de dépendance et d’isolation doivent continuer à passer.

Les futures vérifications prioritaires sont :

- action Technicien visible et confirmée côté Chef ;
- véhicule terminé mais non livré toujours présent ;
- accord absent bloquant seulement le périmètre concerné ;
- même phase et même ETA sur toutes les vues ;
- reprise ne supprimant pas une attente encore réelle ;
- opérations parallèles correctement affichées ;
- parcours mobile sans défilement horizontal d’actions.

# 20. Score actuel vs cible

Ces notes évaluent l’expérience déductible du code audité. Elles ne remplacent pas une mesure d’usage. Pour « charge cognitive » et « nombre de clics », une note élevée signifie une meilleure simplicité.

| Critère | Actuel /10 | Justification | Cible /10 |
|---|---:|---|---:|
| Simplicité globale | **5** | Des simplifications réelles, mais plusieurs ambiguïtés centrales | **8** |
| Clarté navigation | **6** | Accueils par rôle ; encore 7 entrées Chef et 6 Directeur | **9** |
| Lisibilité | **6** | Hiérarchie présente, densité excessive sur les fiches | **8** |
| Efficacité Chef Atelier | **5** | Bon socle Aujourd’hui, trop de lectures et changements de contexte | **9** |
| Efficacité Réception | **4** | Promesse, accord, contact et disponibilité insuffisamment réunis | **9** |
| Efficacité Technicien | **7** | Une vue et MAINTENANT/ENSUITE déjà présents | **9** |
| Efficacité Directeur | **6** | Pilotage disponible, décisions noyées parmi les indicateurs | **9** |
| Visibilité véhicule | **5** | Risque d’exclusion après clôture et phase ambiguë | **9** |
| Visibilité activité technicien | **7** | Exécution et prochaine tâche visibles ; disponibilité à fiabiliser | **9** |
| Gestion des exceptions | **5** | Nombreuses règles, mais priorités et populations peu unifiées | **9** |
| Planification | **8** | Moteur riche et invariants ciblés solides ; interaction perfectible | **9** |
| Mobile | **6** | Adaptations réelles ; densité et barre horizontale pénalisantes | **9** |
| Charge cognitive | **4** | L’utilisateur doit rapprocher plusieurs représentations | **8** |
| Nombre de clics | **6** | Démarrage direct ; dialogues et navigation évitables ailleurs | **9** |
| Traçabilité | **8** | Provenance, sessions et historique ; partage par rôle à vérifier | **9** |
| Cohérence des statuts | **3** | Planifié/reçu/en travaux et terminé/clôturé/livré se confondent | **9** |
| Séparation des rôles | **6** | Isolation technicien réelle ; CQ et Réception moins aboutis | **9** |
| Qualité du cockpit atelier | **6** | Les composants utiles existent, mais leur réunion reste à faire | **9** |

Je n’utiliserais pas une moyenne globale pour arbitrer le projet : elle masquerait la faiblesse des statuts et les points critiques de fiabilité derrière la qualité du moteur.

# 21. Roadmap de simplification

Les propositions du rapport se regroupent dans les douze lots suivants. Ce registre couvre leur valeur, leur coût et l’alternative la plus simple.

| Lot | Propositions couvertes | Valeur utilisateur | Complexité ajoutée / maintenance | Risque principal | Alternative plus simple |
|---|---|---|---|---|---|
| P1 | Transport autorisé et retour de synchronisation — F01/F19 | Confiance entre postes | Complexité moyenne ; maintenance moyenne, concentrée | Élargir les accès par erreur | Conserver les règles serveur ; dissocier les seules commandes techniques du transport métier |
| P2 | Présence et finalisation — F02 | Aucun véhicule oublié ; remise maîtrisée | Moyenne ; faible après unification | Requalifier à tort les dossiers historiques | D’abord corriger les filtres et ajouter les gardes avec les données existantes |
| P3 | Accord distinct de l’import — F03 | Périmètre exécuté explicite | Moyenne ; faible à moyenne | Bloquer des travaux déjà autorisés ailleurs | Référence vers l’accord existant, sans nouvelle chaîne documentaire |
| P4 | Phase, activité, disponibilité, exécutabilité — F05/F09/F16 | Même vérité sur tous les écrans | Moyenne ; maintenance réduite si lecture commune | Changer des compteurs historiques | Projection commune des données, sans multiplier les statuts stockés |
| P5 | ETA et engagement client — F04 | Réponse client fiable | Faible à moyenne ; maintenance faible | Présenter l’ancienne estimation comme une promesse | Afficher immédiatement la réserve ETA ; ne renseigner la promesse que si elle est connue |
| P6 | Aujourd’hui unifié et actions contextuelles — F07/F08 | Commandement depuis un écran | Moyenne ; faible si composants partagés | Masquer un cas auparavant visible | Fusion progressive avec contrôle de la population véhicule |
| P7 | Navigation, rôles, Pilotage — F12/F18 | Réduire apprentissage et bruit | Faible ; maintenance faible | Cacher une action réellement nécessaire | Masquer et déplacer avant de supprimer les capacités |
| P8 | Carte et actions mobiles — F13/F14/F15 | Exécution rapide à une main | Faible ; maintenance faible | Fin accidentelle ou consigne masquée | Replier les détails, conserver une confirmation de fin |
| P9 | Blocage et résolution — F06 | Cause explicite, reprise sûre | Moyenne ; maintenance moyenne | Autoriser une branche encore dépendante | Conserver la portée actuelle jusqu’à preuve d’indépendance |
| P10 | Entrée minimale et opérations PDF — F10/F11 | Accueillir sans devis ; travail lisible | Moyenne ; maintenance moyenne | Perdre une agrégation métier utile | Réutiliser le formulaire et le modèle canonique ; découper seulement les opérations exécutables |
| P11 | Replanification — F17 | Moins de saisie, décisions explicables | Faible à moyenne ; maintenance faible | Créneau demandé différent du créneau accepté | Sélecteur et aperçu, sans drag & drop |
| P12 | Fiche et saisie — F20 | Moins de doublons et de scroll | Faible ; maintenance faible | Cacher une donnée nécessaire à un cas particulier | Champs conditionnels et sections repliées |

**Aucune nouvelle table n’est nécessaire pour la majorité de ces lots.** Deux faits peuvent nécessiter une saisie explicite s’ils ne sont pas déjà conservés de façon exploitable : l’engagement réellement communiqué au client et une décision/échéance non déductible. On ne peut pas les recréer honnêtement par calcul.

### QUICK WINS

**Très faible risque :**

- Réduire la carte technicien.
- Retirer Impression de ses actions primaires.
- Fusionner confirmation de fin et note facultative.
- Supprimer le défilement horizontal des actions.
- Renommer les actions de navigation pour qu’elles annoncent ce qu’elles font.
- Appliquer le filtre correspondant au clic d’un KPI.
- Replier les informations administratives et les provenances répétées.
- Afficher « estimation à confirmer » lorsque l’information existe déjà dans le modèle.

**Critère de sortie :** aucune règle métier ni donnée historique modifiée ; actions et consignes restent accessibles.

Les corrections de synchronisation, d’accord et de finalisation ne doivent pas être qualifiées de quick wins sans risque. Elles constituent le premier lot de fond.

### PHASE S1

**Simplification structurelle UX, précédée de la fiabilité indispensable.**

1. Corriger/vérifier le transport par rôle.
2. Séparer présence, fin des travaux et remise.
3. Rendre l’autorisation du périmètre explicite.
4. Unifier phase, activité et ETA.
5. Fusionner les trois lectures d’Aujourd’hui.
6. Installer le dossier contextuel et la navigation à quatre espaces.

**Critères de sortie :**

- même véhicule, même phase et même ETA partout ;
- aucun véhicule présent exclu par une clôture ;
- action locale et confirmation partagée clairement distinguées ;
- aucune autorisation déduite du seul import.

### PHASE S2

**Workspaces par rôle.**

- Chef : exceptions et exécution.
- Réception : client, engagement et disponibilité.
- Technicien : une opération et une action.
- Directeur : décisions et capacité.
- CQ : file à finaliser.
- Garantie : file filtrée, sans nouvel espace autonome.

**Critère de sortie :** chaque rôle réussit son test des cinq secondes sur des cas représentatifs ; le Directeur réussit son diagnostic global en moins de trente secondes.

### PHASE S3

**Management by exception.**

- Unifier les règles.
- Attribuer responsable et échéance.
- Distinguer retard établi et risque.
- Éviter les doublons par véhicule.
- Calibrer les seuils avec l’atelier.
- Clarifier la portée et la résolution des blocages.

**Critère de sortie :** chaque alerte affichée conduit à une action identifiable ; les cas normaux ne nécessitent pas d’acquittement.

### PHASE S4

**Optimisations secondaires.**

- Améliorer la transformation des opérations PDF.
- Étendre l’entrée minimale sans document.
- Simplifier les alternatives de planning.
- Ajuster le Gantt aux horaires effectifs.
- Améliorer l’historique et les filtres récurrents.
- Envisager une connexion ERP seulement sur une ressaisie mesurée.

**Critère de sortie :** chaque évolution supprime une interaction répétée ou résout une limite démontrée. Aucun enrichissement de dashboard par simple recherche de sophistication.

# 22. Les 10 changements au meilleur ROI

Classement recommandé en intégrant risque métier, fréquence et effort :

1. **Vérifier et corriger la synchronisation des rôles métier.** Un cockpit partagé n’a de valeur que si l’activité circule correctement entre les postes.
2. **Conserver chaque véhicule présent jusqu’à sa remise et rétablir une finalisation courte.** C’est la base du contrôle du parc.
3. **Distinguer devis, validation technique et accord.** Empêcher le logiciel de présenter une autorisation non établie.
4. **Unifier la phase, l’activité réelle et les compteurs.** Éliminer les contradictions que l’utilisateur doit résoudre mentalement.
5. **Séparer ETA et engagement client.** Réduire les annonces fragiles et rendre les risques de livraison visibles.
6. **Fusionner Aujourd’hui autour d’une liste véhicule unique.** Faire du cockpit le poste de travail du Chef.
7. **Alléger la vue technicien et ses dialogues.** Gain quotidien direct, faible coût de maintenance.
8. **Réduire les menus et spécialiser les accueils.** Utiliser les droits existants pour montrer moins.
9. **Rendre les actions contextuelles et les KPI réellement filtrants.** Supprimer les déplacements sans supprimer l’information.
10. **Remplacer la saisie technique de replanification et corriger les libellés d’opération.** Améliorer les arbitrages et la compréhension sans refaire le moteur.

# 23. Proposition finale de NIMR-SAV simplifié

À l’arrivée d’un véhicule, la Réception recherche son identité ou importe le devis. Si le devis n’existe pas encore, elle ouvre le même dossier avec un motif court. Elle confirme la présence ; le véhicule entre immédiatement dans le parc présent.

Le Chef voit ce véhicule dans Aujourd’hui. Il vérifie les opérations proposées, leur périmètre autorisé et les conditions nécessaires. Il accepte une proposition d’affectation ou impose une contrainte simple. Les dépendances, calendriers et équipements restent calculés par le moteur.

Le technicien ouvre son téléphone. Une opération apparaît en premier, suivie de l’immatriculation et de la consigne. Il démarre en un geste. L’heure et l’acteur sont enregistrés ; le partage est confirmé clairement.

En cas de difficulté, il choisit un motif court. Le Chef voit le problème, son véhicule et son impact. La Réception ne reçoit une action que si une décision ou une communication client lui appartient. Le Directeur n’est sollicité que pour un arbitrage relevant de lui.

La Réception consulte la même réalité : opération en cours, étape suivante, estimation exploitable ou incertaine, engagement communiqué. Elle n’a pas à interpréter le Gantt pour répondre au client.

La fin de la dernière opération fait passer le véhicule dans la file de finalisation. Le contrôleur valide ou signale une anomalie. Un retour atelier conserve tout le travail initial et ajoute seulement la correction nécessaire.

Une fois prêt, le véhicule reste visible parmi les présents. La Réception informe le client, puis confirme sa remise physique. Le dossier rejoint l’historique sans imposer une seconde action quotidienne d’archivage.

Le Directeur ouvre Pilotage et comprend les engagements menacés, les arbitrages attendus et la capacité. Les dossiers normaux restent consultables, sans exiger son attention.

**Cette expérience peut être construite sur le moteur actuel.** Elle repose sur moins de représentations concurrentes, moins d’étapes administratives et des événements métier mieux définis.

# 24. Verdict final

Si j’étais Directeur SAV demain matin, je demanderais, avant toute nouvelle fonctionnalité :

1. **Prouver qu’une action de chaque rôle est correctement partagée entre les postes.**
2. **Garantir qu’aucun véhicule présent ne disparaît après une clôture atelier.**
3. **Rendre explicites l’autorisation des travaux, la validation finale et la remise physique.**
4. **Afficher partout la même phase, la même activité réelle et une ETA honnête.**
5. **Transformer Aujourd’hui en écran de décision unique pour le Chef.**
6. **Réduire le téléphone du technicien à son opération, sa consigne et ses actions immédiates.**
7. **Donner à la Réception une réponse client complète sans exploration technique.**
8. **Retirer les menus, doublons et dialogues qui ne changent aucune décision.**

**Je ne demanderais pas une réécriture. Je demanderais une simplification vérifiable : chaque personne comprend sa situation, agit au bon endroit, et laisse une trace sans travail administratif supplémentaire.**
