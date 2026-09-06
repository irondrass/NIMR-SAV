# 1. Executive verdict

**NIMR-SAV possède déjà le moteur d'une plateforme d'exécution atelier crédible. Son principal défaut est la confiance inégale que l'on peut accorder à certaines synthèses et à certains retours d'action. La priorité est de rendre ces synthèses exactes, puis de réduire les détours. Une réécriture serait un mauvais investissement.**

Audit du 6 septembre 2026, complété par les corrections autorisées pendant la mission. Référence de départ : **v23.3.34**, commit `3ed0c084db0e433ae70c07209e2a31d4df618e6a`, dépôt `irondrass/NIMR-SAV`. Version issue des corrections : **v23.3.35**. L'autorisation ultérieure de modifier le local, Supabase et le site remplace la consigne initiale de lecture seule. Aucune modification de schéma Supabase n'est nécessaire aux changements retenus.

Le dossier fourni contient deux générations : les fichiers de premier niveau appartiennent à une ancienne v22 ; l'application maintenue se trouve dans `__github_publish_NIMR_SAV`. Le lanceur parent dirige maintenant vers ce dépôt. Le répertoire explicitement marqué sensible n'a pas été utilisé. Le rapport préexistant du 5 septembre est préservé.

**Périmètre probant.** Lecture des fichiers effectivement chargés par `index.html`, des règles métier, permissions, composants de planning et tests ; inspection dans Chromium d'une application locale avec données fictives ; parcours réception, CQ, livraison et technicien ; recette aux largeurs 360, 390 et 430 px. Les anciennes notes d'audit servent de contexte, jamais de preuve suffisante. `js/ui-reception.js` et le prototype React ne sont pas le chemin de production chargé par cette page : leur complexité ne peut pas être imputée directement à l'écran actuel.

**Lecture du rapport.** « Observé » désigne le code ou un parcours réellement inspecté ; « Déduction » une conséquence plausible ; « Cible » une recommandation ; « Corrigé v35 » une modification de cette livraison. Les fréquences, gains et notes sont des estimations de revue, sans statistiques d'usage ni chronométrage de salariés. Le benchmark externe est conceptuel. Aucun essai d'écriture sur des dossiers clients réels ni audit SQL exhaustif de la base en service n'a été effectué pendant cette mission.

Mon jugement est sévère sur un point : une carte agréable qui dit « Prêt », « Disponible » ou « Maintenant » à tort coûte davantage à l'atelier qu'un écran un peu dense. La v35 traite d'abord ces contradictions. La cible tient en **quatre espaces métier**, une administration secondaire, une seule carte par véhicule et une seule surface d'exécution pour le technicien.

# 2. Ce que NIMR-SAV fait déjà très bien

| Acquis observé | Preuve dans le dépôt | Pourquoi le conserver |
|---|---|---|
| Opération métier canonique distincte de ses créneaux | `js/state.js`, `getCaseBusinessTaskRows` ; tests `canonical_task_model_p1003` | Une opération fractionnée ne devient pas plusieurs travaux à interpréter. |
| Dépendances et séquences métier | `js/business-rules-v2187.js` ; test `workshop_001b_dependency_dag` | Empêche de lancer la finition avant les opérations préalables ; protège notamment la carrosserie et la peinture. |
| Planification avec ressources, horaires et indisponibilités | `js/planning.js`, `js/work-hours.js`, `js/ui-planning.js` | L'ETA doit résulter d'une capacité possible, pas d'une addition naïve d'heures. |
| Consigne issue de la ligne de main-d'œuvre | `getPlanningOperationTitle`, `renderTechnicianExactLaborInstruction` | « Remplacer l'alternateur » est plus exploitable que « Mécanique ». La provenance est conservée ; un ancien dossier sans provenance n'est pas artificiellement enrichi. |
| Accueil et navigation adaptés au rôle | `js/state.js`, `ROLE_TABS` ; `js/utils.js`, `renderPrimaryNavigationVisibility` | Le technicien a déjà un espace principal unique ; la réception ne reçoit pas le planning global. |
| Présence physique distincte d'un rendez-vous | `isCasePhysicallyPresent`, `advanceReceptionWorkflow` | Un véhicule attendu n'occupe pas automatiquement l'atelier. |
| Accord explicite distinct d'un import | `getWorkAuthorizationIssues`, `recordWorkAuthorization` | Lire un devis n'autorise pas les travaux. |
| CQ et remise physique distincts | `getCaseFinalizationIssues`, `advanceReceptionWorkflow` | Valider le contrôle ne doit pas livrer le véhicule. |
| Promesse client distincte de l'estimation | `clientCommitment`, `getWorkshopProgressEta` | Une replanification ne doit pas réécrire ce que le conseiller a promis. |
| Persistance locale, file d'envoi et contrôle de concurrence | `js/storage.js`, `js/supabase-sync.js` ; tests `indexeddb_outbox_runtime_p0012`, `offline_concurrency_chaos_p010` | Permet de travailler malgré les coupures et de traiter les divergences. |
| Verrouillage des dossiers finalisés | tests `close_invoice_hard_lock_v2302` | La simplification de l'interface ne doit pas rouvrir une modification interdite. |
| Contrat de livraison PWA versionné | `sw.js`, `js/version.js`, `tests/helpers/release-fingerprint.mjs` | Évite de mélanger HTML, JavaScript et CSS de générations incompatibles. |

Ces acquis sont déjà présents dans la base v34. Les présenter comme des fonctionnalités à reconstruire conduirait à ajouter des couches et à perdre des garanties.

# 3. Les causes principales de complexité

**Plusieurs modèles sont traduits indépendamment.** Le dossier possède ses drapeaux, les travaux leurs familles, le planning ses segments et le CQ son historique. Cette richesse est légitime dans le moteur. Le problème apparaît quand une vue utilise seulement `qualityApproved` pour dire « Prêt » alors que l'action de livraison consulte d'autres prérequis. Corrigé v35 : la phase visible réutilise les gardes de finalisation.

**Le vocabulaire confond parfois prévision et exécution.** Une tâche planifiée possède une durée restante ; cela ne signifie pas qu'elle a commencé. Une tâche bloquée avant son lancement n'est pas « Maintenant ». Un technicien sans tâche active n'est pas forcément disponible : congé, hors horaires, réservation ou prédécesseur peuvent l'empêcher de démarrer. Corrigé v35 dans les synthèses et les motifs affichés.

**Une même information apparaît à plusieurs niveaux.** Aujourd'hui, résumé opérationnel, situation client et détail complet ont chacun leur utilité, mais le passage au détail coûte du repérage. Une ancienne série de files Aujourd'hui restait même construite derrière un bloc masqué. Corrigé v35 : suppression du rendu et du balisage de ces files, accès aux pièces et au planning depuis le panneau du véhicule. Les fonctions historiques encore utilisées par les tests restent conservées : ne pas confondre retirer une interface et supprimer aveuglément son code.

**La responsabilité atelier débordait sur les engagements client.** Une échéance générique de décision pouvait remplacer l'heure d'un rappel. L'utilisateur devait connaître cette convention cachée. Corrigé v35 : engagement, rappel et décision atelier gardent leurs sens respectifs.

**Le retour d'action ne reflétait pas toujours la persistance.** Certains boutons annonçaient le succès avant la résolution de `saveState`. L'annulation d'une action technicien pouvait réactiver des boutons désactivés par leurs gardes. Fermer un panneau pendant une sauvegarde pouvait supprimer le dialogue de confirmation partagé. Ces trois défauts sont corrigés.

**La dette de maintenance est visible dans la structure, pas nécessairement à l'utilisateur.** Les gros fichiers globaux rendent facile l'ajout d'une règle locale qui diverge d'une autre vue. Cible : extraire progressivement des sélecteurs métier purs, uniquement quand une modification le justifie. Ni framework supplémentaire ni migration d'ensemble ne sont nécessaires maintenant.

**Le test “aucune formation” échoue surtout sur les conventions.** « Ordre », « réclamation client », « accord », « devis », « reliquat », phase et statut ne sont pas interchangeables. Une personne expérimentée en SAV peut connaître son métier sans connaître les particularités des anciens dossiers NIMR. Il faut privilégier un libellé métier visible et reléguer les codes dans le détail.

# 4. Les 20 principales frictions

Fréquence estimée : Q = exposition quotidienne probable ; C = conditionnelle à une situation ; R = rare mais importante. Effort : S = local ; M = plusieurs vues ; L = organisation/intégration. Le classement suit un ratio qualitatif **impact / complexité**, sans prétendre à un calcul économique mesuré. F01–F19 sont corrigées dans la v35 ; F20 est un choix de cible restant à valider par l'usage.

| Rang / ID | Problème observé et cause profonde | Sévérité / fréquence / rôle | Solution minimale | Effort | Gain attendu |
|---|---|---|---|---|---|
| 1 — F01 | « Prêt » calculé avec le CQ seul, contrairement aux gardes de remise | Haute / C / réception, CQ | Réutiliser `getCaseFinalizationIssues` dans `isCaseReadyForDelivery` | S | Éviter une annonce de disponibilité fausse |
| 2 — F02 | Succès technicien annoncé sans attendre la sauvegarde | Haute / C / technicien | Attendre `saveState`, expliquer l'échec | S | Éviter de quitter le poste après un faux succès |
| 3 — F03 | Annulation d'une action réactive tous les boutons technicien | Haute / C / technicien | Restaurer seulement l'état initial des boutons encore présents | S | Conserver les interdictions de démarrage |
| 4 — F04 | Fenêtre de confirmation supprimée avec un panneau fermé pendant la sauvegarde | Haute / C / CQ, réception | Restituer le dialogue partagé avant l'attente et à la fermeture | S | Préserver l'enchaînement CQ → livraison |
| 5 — F05 | Responsabilité/échéance atelier écrasent le sens d'un rappel client | Haute / Q / réception | Ne remplacer que le responsable des exceptions atelier ; dates métier prioritaires | S | Rappeler la bonne personne au bon moment |
| 6 — F06 | `remainingMinutes > 0` interprété comme une reprise | Moyenne / Q / chef | Déduire la reprise d'un état d'exécution réel | S | Action « démarrer » cohérente pour un travail neuf |
| 7 — F07 | Tâche bloquée avant démarrage comptée comme activité actuelle | Haute / C / chef | Exiger une trace de démarrage pour ce cas | S | Savoir qui travaille réellement |
| 8 — F08 | Futur technicien affecté accompagné d'un « Non affecté » trompeur | Moyenne / Q / chef | Nom près de l'opération concernée ; ne pas afficher un titulaire actuel fictif | S | Éviter une réaffectation inutile |
| 9 — F09 | Compteur des véhicules attendus décrit comme présence atelier | Moyenne / Q / réception | Compter présents et attendus séparément | S | Charge physique compréhensible |
| 10 — F10 | Une note client récente masque l'absence d'évolution des travaux | Haute / C / chef | Horodatage d'activité atelier distinct des échanges | S | Faire ressortir les véhicules immobiles |
| 11 — F11 | Pause classée comme dépassement actif ; filtre stagnant incohérent avec l'alerte | Moyenne / C / chef | Dépassement actif limité au travail démarré ; filtre dérivé de la même exception | S | Réduire les faux signaux |
| 12 — F12 | CQ rejeté traité comme un contrôle ordinaire à faire | Haute / C / CQ, chef | Action « Corriger l'anomalie qualité », obstacles explicites | S | Empêcher un retour atelier invisible |
| 13 — F13 | Une seule exception visible sans indication des autres | Moyenne / Q / chef, réception | Priorité par rôle, puis « + N points » ; détail existant | S | Ne pas perdre le rappel derrière un blocage |
| 14 — F14 | Une fiche ouverte permet une décision sur une révision remplacée | Haute / C / tous décideurs | Comparer identité/révision visible avant la décision | M | Éviter d'écraser une évolution reçue entretemps |
| 15 — F15 | « Disponible » déduit de l'absence de travail actif ; prochain travail supposé exécutable | Haute / C / chef | Calendrier et gardes réels, « prévue » / « prête à démarrer » | M | Distinguer capacité libre et absence d'activité |
| 16 — F16 | Résoudre pièces/blocage oblige à chercher dans le dossier complet | Moyenne / Q / chef, réception | Réutiliser les contrôles existants dans le panneau véhicule | S | Décision depuis Aujourd'hui |
| 17 — F17 | Retirer un blocage remet les pièces à « non vérifié » | Haute / C / chef, réception | Conserver leur état ; demander de résoudre la pénurie explicitement | S | Ne pas effacer une information vraie |
| 18 — F18 | Vue Équipe ouvre le dossier général ; anciens blocs Aujourd'hui toujours calculés | Moyenne / Q / chef | Même panneau d'action ; retrait des anciennes files masquées | S | Moins de détours et de rendu inutile |
| 19 — F19 | Rafraîchissement remplace les cartes ; filtre d'un rôle persiste après changement d'utilisateur | Moyenne / Q / postes partagés | Ne remplacer que le contenu changé ; restaurer le focus ; réinitialiser le contexte | M | Interaction plus stable, moins de vues faussement vides |
| 20 — F20 | Ressources/Atelier au même niveau quotidien que les véhicules pour le chef | Faible / Q / chef | Cible : accès secondaire ressources ; conserver le planning opérationnel | M | Réduire l'espace de choix, après observation d'usage |

La version locale obsolète lancée depuis le parent était une friction de déploiement supplémentaire, corrigée par redirection du lanceur. Elle n'est pas comptée comme défaut du runtime v34.

# 5. Analyse rôle par rôle

| Rôle | Accueil observé | Test 5 secondes — déduction de revue | Cible et travail réellement utile |
|---|---|---|---|
| Directeur SAV | Pilotage ; accès Aujourd'hui, Dossiers, Planning | Peut lire des indicateurs ; une garantie de compréhension en 30 s demande un test métier. Il ne doit pas devoir reconstituer les urgences dossier par dossier. | Pilotage : charge/capacité, engagements à risque, blocages nécessitant arbitrage, tendance. Accès Aujourd'hui pour approfondir, pas pour devenir répartiteur permanent. |
| Chef d'atelier | Aujourd'hui, véhicules et équipe | Déjà proche de la bonne structure ; les faux « actuel/disponible » compromettaient la première lecture. V35 les corrige et fournit « À traiter ». | Une file de décisions puis l'atelier en cours ; affectation et arbitrage au planning seulement si besoin. Pièces, responsabilité et suivi depuis la carte. |
| Réception | Aujourd'hui et Dossiers | Motif, promesse et contact sont disponibles ; la v35 sépare les attendus et met l'alerte client pertinente en avant. La qualité du message client dépend encore des champs réellement renseignés. | Dire : ce qui est fait, ce qui empêche de finir, heure estimée, heure promise, prochain contact. Saisir uniquement une information nouvelle. |
| Technicien | Espace Technicien unique, Maintenant/Ensuite | Le bouton principal est compréhensible ; une consigne historique générique ou un prérequis caché ralentit. V35 affiche le premier motif empêchant le démarrage. | Véhicule, travail exact, durée, action. Pause/Terminer pendant le travail ; Reprendre si interrompu ; problème/note/photo en secondaire. Aucun besoin du Gantt global. |
| Garantie / support | Pas de rôle canonique spécifique ; filtre support dans Aujourd'hui | Une recherche lexicale peut aider mais ne garantit pas une file exhaustive. | File filtrée dans Dossiers/Aujourd'hui avec droits existants adaptés à la personne. Pas de nouveau workspace sans volume et responsabilité démontrés. |
| CQ / livraison | CQ a Aujourd'hui/Dossiers ; permissions CQ distinctes de la remise | La file est spécifique ; v35 retire les filtres sans utilité et montre les conditions de finalisation. | CQ contrôle, accepte ou motive une anomalie. Réception remet physiquement le véhicule. Le chef peut intervenir selon ses droits existants. |

Le « 5 secondes » est un critère de validation cible, pas un résultat chronométré. Un protocole utile consiste à montrer un état figé à une personne de chaque rôle puis demander une seule décision : prochain travail ; premier problème ; message client ; atelier sous contrôle. Mesurer erreurs et hésitations autant que le temps. Ne pas demander une formation préalable pour réussir ce test.

La réduction des menus n'est pas une réduction des permissions de sécurité. La v35 conserve le modèle de droits. Si NIMR souhaite retirer des droits opérationnels au directeur, ce sera une décision de responsabilité à matérialiser dans les contrôles d'autorisation, pas seulement en cachant des boutons.

# 6. Analyse écran par écran

| Vue réellement accessible ou surface secondaire | Verdict | Décision et justification |
|---|---|---|
| Connexion, récupération et état de connexion | KEEP | Identité et récupération nécessaires. Ne pas déplacer ces fonctions dans le cockpit. Pas de changement des comptes dans cette mission. |
| Aujourd'hui — véhicules | SIMPLIFY | Une carte par véhicule, une phase, une exception principale, action contextuelle. Corrigé v35 : exactitude et accès rapides. |
| Aujourd'hui — équipe | KEEP + SIMPLIFY | Nécessaire au chef, cachée à réception/CQ. Distinguer disponibilité, activité interrompue, tâche future et garde de démarrage. |
| Anciennes files secondaires Aujourd'hui masquées | REMOVE | Balisage et construction retirés v35 ; une seconde classification ne doit pas concurrencer les cartes. |
| Recherche et filtres Aujourd'hui | SIMPLIFY | Tous / À traiter / Prêts accessibles directement ; filtres fins conservés en sélection secondaire ; CQ limité aux filtres pertinents. |
| Liste Dossiers | KEEP | Recherche, historique, dossiers attendus/livrés et cas exceptionnels. Ce n'est pas l'accueil d'exécution du technicien. |
| Dossier — Résumé et travaux | SIMPLIFY | Conserver dossier de référence, accord, réclamations, opérations. Réduire les répétitions dans un futur ajustement ciblé, sans supprimer la preuve source. |
| Dossier — Photos | KEEP | Preuve utile à réception, diagnostic et CQ ; accessible au moment nécessaire. |
| Dossier — Planning | KEEP + HIDE BY ROLE | Réglage ciblé de ce véhicule. Raccourci v35 depuis le panneau Aujourd'hui pour les utilisateurs autorisés. |
| Dossier — Atelier | SIMPLIFY | Détail d'exécution et historique utiles pour enquêter. Le technicien ne doit pas avoir besoin de le visiter pour chaque pointage. |
| Panneau opérationnel véhicule | MERGE | Regroupe les décisions courantes et réutilise les contrôles existants. Les informations complètes restent à un niveau supplémentaire. |
| Nouvelle arrivée / import PDF | KEEP + AUTOMATE | Deux modes nécessaires : devis disponible ou arrivée sans devis. Préremplir depuis l'import, contrôler identité et motif. Import ≠ accord. |
| Planning global | HIDE BY ROLE + SIMPLIFY | Poste d'arbitrage du chef ; consultation directeur si utile. Ne pas en faire le centre du quotidien réception/technicien. |
| Pilotage | HIDE BY ROLE | À destination du directeur et du chef pour l'analyse. Les KPI doivent avoir horizon, dénominateur et décision associés. |
| Technicien — Maintenant/Ensuite | KEEP | Bonne structure déjà présente ; v35 clarifie les gardes et fiabilise l'action/sauvegarde. |
| Technicien — problème/note/photo/détails | KEEP en secondaire | Saisie conditionnelle justifiée. Aucune multiplication d'écrans principaux. |
| CQ | KEEP comme projection d'Aujourd'hui | Aucun module séparé nécessaire pour une file de contrôle, une validation et un retour motivé. |
| Support/garantie | MERGE avec file filtrée | Le dépôt ne justifie pas une nouvelle application dans l'application. Limite actuelle : filtre lexical. |
| Ressources, horaires, absences | HIDE BY ROLE | Garder leur moteur et leurs écrans de gestion ; accès secondaire cible pour le chef. |
| Administration, sauvegarde, import/export, diagnostic de sync | HIDE BY ROLE | Nécessaires aux administrateurs, inutiles au pointage technicien. État de sync global visible ; détails techniques à la demande. |
| Fiche imprimée / livraison | KEEP | Document exploitable hors écran, sous réserve de champs réellement renseignés. Ne pas recopier la fiche à la main. |
| Écran hors connexion / mise à jour PWA | KEEP | Protection de continuité ; mise à jour cohérente de tous les assets, sans effacer l'outbox. |

# 7. Architecture actuelle vs architecture cible

Architecture **observée v34**, déjà sensiblement simplifiée par les versions précédentes :

```text
Identité + droits
  ├─ Accueil selon rôle
  │    ├─ Aujourd'hui : véhicules + équipe + filtres
  │    ├─ Pilotage
  │    └─ Technicien : Maintenant / Ensuite
  ├─ Dossiers → Résumé/travaux | Photos | Planning | Atelier
  ├─ Planning global
  ├─ Ressources / Atelier / administration selon droits
  └─ Création → PDF ou arrivée sans devis

État dossier + travaux métier + segments planning + workflow CQ
  → fonctions de synthèse par vue
  → stockage local / outbox / synchronisation Supabase
```

Architecture **cible** :

```text
4 espaces métier partagés, filtrés par rôle
  Aujourd'hui      → Décider maintenant → même panneau véhicule
  Véhicules       → Rechercher / documenter / consulter l'historique
  Planning        → Arbitrer capacité et séquence
  Pilotage        → Comprendre charge, engagements et tendances

Technicien : une projection d'exécution unique Maintenant / Ensuite
CQ : une projection Aujourd'hui « Véhicules à contrôler »
Support : une file filtrée, sans module supplémentaire
Administration : accès secondaire

Sélecteurs métier communs → une vérité visible
  état + opération + affectation + ETA + blocage + accord + finalisation
Moteur planning/DAG et données existantes conservés
```

**Sources de vérité à respecter.** La v35 rapproche l'UI de ce contrat ; elle ne refond pas le stockage.

| Information | Source autoritaire | Ce qui ne doit pas devenir une seconde vérité |
|---|---|---|
| Présence véhicule | Réception physique, drapeau et horodatage de workflow normalisés | Date de RDV, présence dans une liste |
| Phase visible | `getCaseOperationalPhase`, dérivée de présence/exécution/finalisation | Sélecteur manuel de phase supplémentaire |
| Opération | Famille de tâche métier et lignes source liées ; `getCaseBusinessTaskRows` | Chaque fragment horaire comme nouveau travail |
| Consigne | Ligne de MO/provenance fiable, puis libellé de repli explicite | Une consigne inventée à partir d'un nom de phase |
| Technicien | Affectation humaine de l'opération/créneau concerné | Nom générique enregistré ailleurs dans le dossier |
| Réel | Événements de démarrage, sessions, pause et fin | Horaire prévu supposé réellement exécuté |
| Prévision et ETA | Planning recalculé et `deliveryEstimate` validé par le modèle | Promesse réécrite automatiquement pour cacher le retard |
| Promesse / rappel | `clientCommitment.promisedAt` / `nextContactAt` | `exceptionFollowup.dueAt` |
| Décision atelier | `exceptionFollowup` et responsable actif | Propriétaire unique arbitraire de tous les engagements |
| Blocage | Cause dossier/pièces et blocage d'opération, avec portée conservée | Bouton « débloquer » qui efface toutes les causes |
| Accord | Preuve explicite par ordre via `recordWorkAuthorization` | PDF importé, statut commercial ou accord présumé |
| Pièces | État atelier saisi/confirmé ; stock physique futur via ERP si disponible | Stock théorique inventé dans NIMR |
| CQ | Statut de contrôle et historique ; rejet prioritaire sur ancien drapeau | Case cochée ancienne qui masque une anomalie |
| Prêt / livré | Gardes de finalisation ; remise physique distincte | Travaux terminés assimilés à véhicule remis |
| Persistance partagée | Accusé serveur/concurrence du système de sync | Succès de l'écriture locale assimilé à réception sur tous les postes |

**Frontière ERP.** NAVISION reste le système de référence pour facturation, comptabilité, prix, références et mouvements de stock, tiers et documents commerciaux selon l'organisation existante. NIMR gère présence, motif atelier, consignes d'exécution, affectation, séquence, réel, blocages, CQ, disponibilité estimée et engagements de suivi. NIMR peut porter une copie de référence ou un justificatif, pas recréer une gestion de stock ou une comptabilité parallèle.

Le devis PDF réduit déjà une saisie. Une intégration ERP automatique ne se justifie que si l'on observe une recopie récurrente, connaît l'identifiant d'échange et dispose d'une interface autorisée. Aucun connecteur NAVISION opérationnel n'est établi par cet audit ; aucune synchronisation inventée n'est annoncée.

# 8. Navigation cible minimale

**Quatre entrées métier globales** : Aujourd'hui, Véhicules, Planning, Pilotage. **Une administration secondaire**, hors navigation quotidienne. « Nouvelle arrivée » est une action, pas un cinquième espace métier. « Technicien » est une projection propre au rôle, pas une navigation supplémentaire imposée aux autres.

| Rôle | Entrées principales actuellement visibles | Nombre actuel | Cible exacte | Nombre cible |
|---|---|---:|---|---:|
| Directeur | Pilotage, Aujourd'hui, Dossiers, Planning | 4 | Pilotage, Aujourd'hui, Véhicules | 3 |
| Chef | Aujourd'hui, Dossiers, Planning, Pilotage, Atelier | 5 | Aujourd'hui, Véhicules, Planning, Pilotage | 4 |
| Réception | Aujourd'hui, Dossiers | 2 | Aujourd'hui, Véhicules | 2 |
| Technicien | Technicien | 1 | Mon travail | 1 |
| CQ | Aujourd'hui, Dossiers | 2 | À contrôler, Véhicules | 2 |
| Support | Aucun rôle dédié | — | Aujourd'hui filtré, Véhicules selon droits attribués | 2 |
| Administration technique | Aujourd'hui, Dossiers, Planning, Pilotage, Atelier + réglages | 5 | 4 espaces métier + administration secondaire | 4 |

Comptage de la barre principale via `renderPrimaryNavigationVisibility`, et non de tous les panneaux cachés présents dans le HTML. Le renommage de Dossiers en Véhicules et la réduction des accès directeur/chef sont une **cible**, pas une modification silencieuse de cette livraison. Les droits larges existants et les accès connus sont conservés ; la v35 améliore leur usage immédiat sans perturber tous les repères.

# 9. Today / Live Control Tower cible

Le haut de l'écran doit répondre à « quel périmètre suis-je en train de voir ? » : date, atelier ou file du rôle, état de synchronisation. Ensuite un compte compact **présents / attendus**, sans mélanger les deux. Un unique filtre rapide **Tous / À traiter / Prêts**, recherche immatriculation ou client, puis filtres détaillés dans le contrôle secondaire. Pour le CQ, la file est déjà « à contrôler » et le raccourci Prêts est inutile.

```text
AUJOURD'HUI                         [Nouvelle arrivée]
12 présents · 4 attendus            Synchronisation : …
[Tous] [À traiter 3] [Prêts 2]       Rechercher… [Filtres]

À traiter dans la liste : cause, responsable, échéance
  123 TU 456 | À préparer | Pièce manquante | Chef | Décider
  234 TU 567 | En intervention | Promesse en risque | Réception

Véhicules normaux : phase + maintenant + ensuite + estimation
  345 TU 678 | En intervention | Remplacer alternateur | 15:30

ÉQUIPE — chef seulement
  Ali : maintenant … | ensuite … | disponible/prévue/garde
```

Maquette cible illustrative : les nombres sont fictifs. Ne pas ajouter huit cartes KPI pour afficher les huit réponses ; les comptes peuvent vivre dans les filtres et les cartes. L'état de sync existe déjà dans le shell.

**Corrigé v35 :** comptage physique, filtres rapides, alerte pertinente par rôle, indication des exceptions supplémentaires, panneau commun aux cartes véhicule et équipe, garde de révision, pièces/blocage et raccourci planning, maintien du focus lors des mises à jour. L'ordre visuel privilégie les problèmes puis le flux normal.

**Limite assumée :** affecter ou replanifier exige encore le panneau planning ciblé ; l'import complet et l'analyse historique passent par le dossier. Forcer toute fonction dans Aujourd'hui recréerait une fiche géante. La majorité des décisions courantes peut être rapprochée ; une promesse de « 100 % en un écran » serait mauvaise pour la lisibilité.

# 10. Carte véhicule cible

```text
123 TU 456 · Toyota Hilux                       EN INTERVENTION
Motif : bruit au démarrage

MAINTENANT   Remplacer alternateur — Ali
ENSUITE      Vérifier la charge et l'absence de défaut — Sami

ESTIMATION  15:30          PROMIS AU CLIENT  16:00
CONTACT     avant 14:30    (réception seulement)

À TRAITER   Pièce attendue · responsable : Chef · échéance 13:00
            + 1 autre point
                                              [Consulter / agir]
```

L'ordre est volontaire : identité → motif → phase → opération → titulaire → suite → temps → décision. Le nom du client est utile à la réception ; le technicien n'a pas besoin du détail commercial. Le titre du travail prime sur la famille mécanique/carrosserie/peinture, conservée en information secondaire si elle aide.

Règles concrètes v35 : « Aucune opération démarrée » pour une affectation future ; titulaire affiché avec l'opération future ; « Travaux terminés » après exécution ; « Contrôle / préparation » en finalisation ; « Remise du véhicule » une fois réellement prêt. Si l'ETA n'est pas fiable : **À confirmer**, jamais un faux horaire précis. La promesse client reste affichée même si elle devient inconfortable.

Une seule phase principale. Rouge et orange portent une exception avec du texte ; la couleur ne remplace ni la cause ni le responsable. Pas de barre de pourcentage décorative : un pourcentage de tâches terminées ne prédit pas à lui seul la durée restante.

# 11. Carte technicien cible

```text
ALI BEN …                         EN COURS / DISPONIBLE / INDISPONIBLE
MAINTENANT
  123 TU 456 · Remplacer alternateur
  Démarré 10:15 · prévu 60 min · réel affiché selon sessions

ENSUITE · PRÉVUE
  345 TU 678 · Contrôler le circuit de charge
  Affecté à 11:30
  Avant de démarrer : diagnostic précédent à terminer
```

Pour le chef : les deux lignes sont consultables depuis Aujourd'hui. Pour le technicien : la carte courante porte les actions, la suivante est une indication de suite. **Une tâche future n'est pas une instruction de démarrage** tant que ses gardes ne passent pas.

Corrigé v35 : travail bloqué avant démarrage exclu de l'activité actuelle ; blocage après démarrage conservé comme intervention interrompue ; disponibilité calculée avec les contraintes existantes ; étiquette prévue/prête et première garde explicite. Le moteur peut autoriser une prochaine opération ; l'interface ne doit pas annoncer une disponibilité générale en ignorant les horaires.

Ne pas transformer cette carte en surveillance individuelle permanente. Les indicateurs de productivité appartiennent au pilotage avec leurs règles de calcul, pas à chaque action de pointage.

# 12. Workflow cible arrivée → livraison

**Six phases visibles suffisent** : Attendu → À préparer → En intervention → À finaliser → Prêt → Livré. Un blocage est un attribut transversal, pas une nouvelle étape qui efface la position du véhicule.

```text
ATTENDU
  rendez-vous ou dossier créé
      ↓ confirmer la présence physique
À PRÉPARER
  identité + motif → diagnostic/travaux → accord → pièces → capacité
      ↓ démarrage autorisé d'une opération
EN INTERVENTION
  exécuter → terminer ; pause/reprise/blocage dans les travaux
      ↓ travaux terminés et cohérence vérifiée
À FINALISER
  contrôle, essai si applicable, anomalies, préparation
      ├─ anomalie → correction atelier → nouveau contrôle
      └─ contrôles validés + aucun obstacle à la remise
PRÊT
  information client et préparation de la remise
      ↓ confirmation de remise physique par rôle autorisé
LIVRÉ
  historique/lecture ; clôture commerciale selon ERP et verrouillage
```

L'accord, la disponibilité des pièces et la préparation de capacité sont des prérequis ; ils peuvent être obtenus dans un ordre pratique. Imposer un écran par prérequis créerait une bureaucratie sans bénéfice. Un diagnostic est une opération et peut révéler un supplément : ce dernier a sa propre autorisation, pas un accord hérité aveuglément du premier devis.

Le refus CQ garde un motif et retourne vers une correction. Il ne valide pas les travaux par accident. Corrigé v35 : l'état Prêt et le bouton de remise consultent les mêmes gardes ; un dossier avec contrôle antérieur validé, mais nouvelle opération ou réclamation bloquante, repasse visiblement en finalisation.

« Informé » n'est pas un septième état du véhicule : c'est un événement de contact. « Facturé » ne remplace pas « Livré » : la remise physique et le document commercial répondent à des questions différentes.

# 13. Statuts à supprimer / fusionner / conserver

La réduction porte sur ce que la personne doit interpréter. Supprimer les états techniques stockés serait dangereux pour les reprises, les migrations et le planning. Aucun nouvel état persistant n'est introduit dans la v35.

| État ou vocabulaire actuel | Cible visible | Traitement |
|---|---|---|
| Dossier sans réception, RDV futur | Attendu | Conserver la présence physique comme séparation. |
| `chief_validation`, préparation/accord/planification avant lancement | À préparer | Fusionner dans la phase visible ; préciser le prérequis bloquant dans l'action. |
| `planning` avec affectation sans démarrage | À préparer · opération prévue | Ne pas afficher En intervention à partir du créneau seul. |
| Travail réellement démarré, `in_progress` | En intervention | Conserver. |
| `paused`, reliquat, reprise | En intervention + Pause sur l'opération | Conserver le sous-état d'exécution ; ne pas créer une phase véhicule supplémentaire. |
| `blocked`, `waiting_parts`, `blocked_parts`, causes dossier | Phase actuelle + Bloqué — cause | Conserver les causes et portées ; une alerte ne remplace pas la phase. |
| `completed`, travaux terminés | À finaliser | La fin du travail ne garantit ni CQ ni livraison. |
| CQ `not_started` / `in_progress` | À finaliser · Contrôle à faire/en cours | Conserver dans le CQ, ne pas multiplier les menus. |
| CQ `rejected` / `rework` | À finaliser ou retour en intervention + anomalie à corriger | Garder rejet et reprise distincts dans l'historique ; action de correction explicite. |
| CQ `validated` | Prêt si toutes les gardes passent | Corrigé v35 ; sinon rester À finaliser avec obstacles. |
| `flags.delivered` | Livré | Confirmation physique et historique conservés. |
| `closed`, `archived`, facturation | Informations secondaires et verrouillage | Ne pas concurrencer le statut opérationnel principal. |
| Pièces `unchecked` | À vérifier | Conserver comme incertitude explicite. |
| Pièces `not_applicable` | Sans pièce nécessaire | Conserver ; éviter d'obliger à simuler un stock. |
| Pièces `available` / `received` | Disponibles pour l'atelier, réception conservée en détail | Cible d'affichage commune possible ; ne pas supprimer la trace de réception. |
| Pièces `partial` / `ordered` | Partielles / commandées | Conserver l'information secondaire ; ne pas déduire automatiquement que toute opération est impossible. |
| `waiting_customer`, accord manquant | Décision client attendue | Responsabilité réception, preuve d'accord distincte. |
| `waiting_internal_approval`, support/diagnostic | Décision atelier attendue | Responsable nommé et échéance si nécessaire. |
| `waiting_technician`, `waiting_lift` | Ressource indisponible | Précondition de planification, pas un nouveau statut de véhicule. |
| « retard », « risque », « sans évolution » | Exceptions calculées | Ne pas en faire des états à sélectionner manuellement. |

Les phases visibles sont donc **6** ; les états d'exécution et les motifs existent derrière elles. La bonne simplification n'est pas de remplacer toute la machine par six chaînes de caractères : c'est de ne demander à personne de comprendre toute la machine pour agir.

# 14. Actions par rôle

Matrice d'usage recommandée : P = responsable principal ; A = intervention autorisée/exceptionnelle selon droits existants ; L = consultation ; — = sans rôle quotidien. Elle n'ajoute pas de permissions au logiciel. Support signifie personne dotée de droits existants adaptés, puisqu'il n'existe pas de rôle dédié.

| Action | Directeur | Chef | Réception | Technicien | Support | CQ |
|---|---|---|---|---|---|---|
| Créer dossier / confirmer arrivée | A | A | P | — | L | L |
| Importer devis et identifier travaux | L | P | P | — | A | L |
| Enregistrer la preuve d'accord | A | A | P | — | A selon délégation | — |
| Qualifier pièces / blocage dossier | A | P | A | Signaler sa tâche | A | L |
| Affecter / recalculer / ajuster planning | A | P | — global | — | L | — |
| Démarrer / pause / reprise / terminer | — | Supervision | — | P sur sa tâche | — | — |
| Ajouter preuve technique | L | A | A selon dossier | P sur son intervention | P | P |
| Modifier engagement et rappel client | A | A | P | — | L | — |
| Attribuer une décision atelier | A | P | A | — | A | Signaler |
| Valider/refuser CQ | A si droits | A | — | — | — | P |
| Confirmer remise physique | A si droits | A | P | — | — | — |
| Voir charge et tendance | P | P | L ciblée | — | L ciblée | — |

**Clics :** les valeurs ci-dessous sont des parcours reconstruits dans le code et l'UI, hors connexion initiale, frappe, sélection de fichier et ouverture du véhicule lorsque précisé. Elles ne sont pas des médianes mesurées en atelier. Les différences de point de départ expliquent les fourchettes. Les confirmations utiles de CQ/livraison restent comptées et conservées.

| Action / point de départ | v34 estimée | v35 / cible | Information et garde avant action | Feedback attendu / risque |
|---|---:|---:|---|---|
| Nouvelle arrivée depuis Aujourd'hui | 1 pour ouvrir + formulaire + soumission | Identique ; cibler 2–3 interactions structurelles | Identité, motif, présence ; aucun accord implicite | Dossier créé, présence correcte ; risque de double dossier à contrôler |
| Démarrer depuis Maintenant | 1 si autorisé | 1 | Affectation, présence, accord, dépendances, ressources | Travail courant mis à jour ; sauvegarde locale confirmée puis sync globale |
| Pause/reprise/fin depuis Maintenant | 1–3 selon motif/confirmation | 1–3 | État actuel, motif si demandé, travail restant | État explicite ; annuler ne réactive plus les actions interdites |
| Lire et agir depuis une carte Équipe | Carte → dossier → repérage, 2–4 | Carte → panneau, 1 ; action ensuite | Bonne opération et bon véhicule | Contexte gardé ; pas de changement d'écran pour consulter |
| Modifier pièces depuis Aujourd'hui | Carte → dossier complet → section → choix, 4–6 | Carte → Pièces/blocage → choix, 3 | Droits édition ; dossier ouvert et à jour | État actualisé ; pénurie ne disparaît pas via un déblocage générique |
| Ajuster le planning d'un véhicule | Carte → dossier complet → Planning, 3 avant réglage | Carte → raccourci planning, 2 avant réglage | Capacité, ordre, autorisation, ressources | Planning recalculé ; engagements client conservés |
| Enregistrer un rappel | Carte → détail suivi → enregistrer, 3 | 3 | Heure de rappel, dernier échange ; révision visible | Date de rappel exacte ; échéance atelier indépendante |
| Valider CQ depuis Aujourd'hui | Carte → validation → confirmer, 3 | 3 | Travaux et réclamations cohérents ; contrôle effectué | Prêt uniquement si finalisable ; succès après sauvegarde |
| Refuser CQ | Carte → anomalie → motif → valider | Identique, motif nécessaire | Anomalie constatée, correction requise | Retour atelier visible et tracé |
| Livrer depuis Aujourd'hui | Carte → remise → confirmer, 3 | 3 | Physiquement prêt et rôle autorisé | Remise tracée, véhicule retiré du flux présent ; dialogue conservé |
| Trouver les problèmes | Ouvrir sélection → choisir filtre | 1, « À traiter » | Périmètre de rôle visible | Liste réduite ; compter les véhicules, pas les alertes doublonnées |

**Saisie : inventaire des groupes réellement rencontrés, et décision de simplification.**

| Groupe de champs/actions | Décision |
|---|---|
| Immatriculation/VIN, véhicule, client, téléphone | Récupérer du dossier ou préremplir à partir du document ; ne saisir que le nouveau/manquant. Garder un moyen de corriger l'identité. |
| Motif de visite / demande client | Garder une saisie humaine courte ; ne pas la déduire d'un statut ou d'un montant. |
| Présence physique | Bouton ou confirmation rapide ; jamais déduite du jour de RDV. |
| Métadonnées de devis importé, référence et lignes | Préremplissage existant à préserver ; aperçu et correction conditionnels. Ne pas obliger une deuxième saisie des mêmes lignes. |
| Ordre : titre, zone, type, état, référence devis/OR, inclusion planning | Hériter les références ; proposer des valeurs par défaut cohérentes ; réserver la décomposition avancée au dossier complet. |
| Supplément : titre, zone, état, phase, motif, opération, heures, pièces | Partir du véhicule et de l'ordre existants. Garder motif, travail réel et accord ; dériver le reste quand la source est fiable. |
| Accord et sa référence | Garder une preuve explicite courte, attachée à l'ordre. Aucun bouton précoché « autorisé » à l'import. |
| Statut pièces, motif et détail de blocage | Choix court ; détail seulement si utile. Réutiliser ces mêmes champs dans le panneau, sans nouvel objet de blocage. |
| Début/fin, durée réelle, utilisateur, historique | Calculer et enregistrer à partir de l'action ; pas de double pointage manuel par défaut. Correction exceptionnelle contrôlée. |
| Promesse, prochain contact, note d'échange | Ne demander que l'information nouvelle. Bouton « Client informé maintenant » pour l'horodatage. Ne pas réécrire la promesse en fonction de l'ETA. |
| Responsable et échéance de décision atelier | Rôle métier par défaut ; nommer une personne seulement pour une décision nécessitant une responsabilité spécifique. |
| CQ, anomalie, essai/préparation | Validation conditionnelle ; motif nécessaire si rejet. Ne pas recopier les travaux dans une nouvelle checklist générale. |
| Ressources, horaires, absences, paramètres, sauvegardes | Administration/chef selon droits, jamais formulaire technicien de routine. |

Supprimer une saisie ne signifie pas supprimer sa donnée : un horodatage peut être indispensable à la traçabilité tout en étant entièrement automatique.

# 15. Management by exception

**Règles exactes implémentées dans `getOperationalExceptions` v35.** Un dossier supprimé ou livré ne produit pas ces alertes. Les alertes d'exécution et de stagnation concernent les véhicules présents dont les travaux ne sont pas terminés. Le propriétaire « Chef Atelier » peut être remplacé par le responsable actif enregistré dans `exceptionFollowup` ; « Réception » reste la responsabilité des engagements client.

| Exception | Déclenchement | Niveau | Responsable / date |
|---|---|---|---|
| Anomalie qualité | CQ `rejected` ou `rework` | Rouge | Chef ; échéance atelier si définie |
| Blocage | Blocage dossier ou au moins une opération bloquée | Rouge | Chef ; cause explicite |
| Promesse dépassée | Heure promise passée et véhicule non prêt selon les gardes | Rouge | Réception ; heure promise inchangée |
| Décision atelier en retard | Échéance atelier passée et exception atelier encore présente | Rouge | Responsable atelier ; échéance de décision |
| Client à recontacter | Prochain contact atteint ou dépassé | Rouge | Réception ; date du rappel |
| Fin estimée dépassée | ETA valide passée, véhicule présent, travaux non terminés | Rouge | Chef |
| Promesse à sécuriser | Promesse future et ETA inconnue ou postérieure à la promesse | Orange | Chef ; heure promise conservée |
| Affectation à revoir | Ressource affectée absente, inactive ou indisponible pour son créneau | Orange | Chef |
| Durée d'opération dépassée | Opération démarrée dont la fin prévue est passée | Orange | Chef ; une pause n'est pas un dépassement actif |
| Accord à obtenir | Véhicule présent, travaux non terminés, accord requis absent | Orange | Réception |
| Sans évolution atelier | Aucun travail actuellement démarré et dernière activité atelier ≥ 24 h | Orange | Chef ; un appel client seul ne réinitialise pas le compteur |

Ordre : sévérité, puis qualité, blocage, promesse dépassée, décision tardive, rappel, ETA, risque promesse, affectation, dépassement, accord, stagnation. La carte réception privilégie ses exceptions client ; le détail donne tous les points. Un responsable attribué ne supprime pas l'alerte : la condition doit être résolue.

**Limites à rendre explicites.** La stagnation utilise 24 heures écoulées, pas 24 heures d'ouverture. Un week-end peut donc générer un signal à examiner. Le dépassement compare la fin prévue, il n'est pas une mesure complète de productivité. L'absence d'ETA rend une promesse incertaine, pas automatiquement impossible. Ces règles doivent être calibrées sur le vrai fonctionnement NIMR avant d'ajouter des notifications.

Pour un diagnostic non résolu ou une attente constructeur : réutiliser motif, blocage et responsable existants. Le filtre support repose aujourd'hui sur les termes du dossier ; ce n'est pas une classification garantie. Ne pas créer des statuts « constructeur 1/2/3 » pour compenser un mauvais usage du motif.

**Benchmark conceptuel et déductions.** Le système Toyota décrit la mise en évidence des anomalies et l'arrêt face à un problème ; j'en retiens pour NIMR la visibilité de la cause et la responsabilité de résolution, sans transposer un modèle industriel complet au SAV. [Toyota Production System](https://global.toyota/en/company/vision-and-philosophy/production-system/)

La documentation AMOS traite des travaux, ressources et contraintes de maintenance ; cela conforte la séparation entre moteur riche et lecture opérationnelle. Il serait disproportionné d'importer les exigences et écrans d'une maintenance aéronautique dans NIMR. [Swiss-AS — Planning](https://www.swiss-as.com/modules/planning)

La convergence recherchée est simple : le flux normal reste calme ; le problème comporte cause, décideur et prochaine action. Ces principes ne démontrent pas un gain chiffré de productivité pour NIMR.

# 16. Simplification du planning

| Le moteur conserve | L'utilisateur voit | L'utilisateur peut modifier |
|---|---|---|
| Familles de tâches, segments, reliquats | Une opération métier, même si fractionnée | Le travail prévu et sa durée lorsqu'il dispose d'une source fiable |
| Dépendances, ordre technique, DAG | « Après le diagnostic » ou première cause empêchant le départ | Priorité métier dans les limites autorisées ; aucune suppression implicite de dépendance |
| Horaires, absences, ressources, capacité | Disponible / indisponible ; début possible | Affectation, date/contraintes de rendez-vous, ressources autorisées |
| Préparation/peinture, lots et règles métier | Travaux réels et séquence compréhensible | Ajustements permis par le moteur, pas les invariants internes |
| Recalcul des créneaux et ETA | Fin estimée et risque par rapport à la promesse | Engagement client séparément, avec responsabilité et historique |
| Historique d'exécution | Début réel, pause, fin, durée utile | Correction exceptionnelle contrôlée, pas réécriture libre du passé |

Le Gantt reste utile au chef lorsqu'il doit arbitrer simultanément des ressources. Il ne constitue pas une meilleure fiche client. Le technicien peut totalement ignorer ses calculs ; la réception peut consulter l'estimation et la cause du retard. Le directeur peut approfondir une saturation sans gérer les créneaux au quotidien.

**Drag & drop :** aucun besoin démontré ne justifie son ajout ici. Les contrôles actuels permettent d'ajuster le planning. Un glisser-déposer tactile ajoute ambiguïté, erreurs et nécessité de confirmer les contraintes ; il n'est utile que si des réaffectations fréquentes sont mesurées et si le moteur valide chaque mouvement. Même principe pour une timeline plus détaillée : conserver celle qui aide réellement à arbitrer.

La documentation du tableau de planification Dynamics 365 décrit un outil de répartition des ressources et de gestion des réservations. J'en déduis que ce type de vue doit rester un outil spécialisé de planification, plutôt qu'un écran obligatoire pour tous. [Microsoft — Schedule board](https://learn.microsoft.com/en-us/dynamics365/field-service/work-with-schedule-board)

Les fonctions de réservation atelier de Keyloop mettent en relation rendez-vous et système de gestion concession. La leçon utile à NIMR est la cohérence des références et la réduction de recopie ; pas la reproduction d'un DMS dans l'outil d'exécution. [Keyloop — Service Booking](https://keyloop.com/products/service-booking)

Le changement v35 reste circonscrit : raccourci vers le planning du véhicule, exactitude de Maintenant/Ensuite et affichage des gardes. Ni ordonnanceur ni graphe ni règles de peinture n'ont été réécrits.

# 17. Simplification mobile technicien

**Résultats techniques constatés.** La recette Chromium passe en **360, 390 et 430 px**. Dans les scénarios testés : pas de débordement horizontal global, boutons d'action d'au moins 44 px, barre d'action visible sans recouvrement par les barres fixes, deux actions principales « Pause » et « Terminer » pendant l'exécution. Les suites de rotation/clavier et de reprise PWA testent des profils simulés ; ce ne sont pas des essais sur téléphones physiques avec gants ou sous soleil.

```text
MON TRAVAIL
MAINTENANT
123 TU 456 · Hilux
REMPLACER ALTERNATEUR
Consigne source utile, sans tableau commercial
Prévu 1 h · état courant

[       PAUSE       ] [       TERMINER       ]
Signaler un problème · Note / photo · Détails

ENSUITE
345 TU 678 · Vérifier circuit de charge
Prévue à … ; prérequis éventuel visible
```

Sur une tâche non démarrée, le bouton est Démarrer et son empêchement est écrit à proximité. Sur une tâche interrompue, Reprendre. L'ordre exact dépend des droits et de l'état existants. Il ne faut pas afficher simultanément Démarrer, Pause, Reprendre et Terminer pour demander au technicien de choisir sa propre machine à états.

Corrigé v35 : première garde lisible sans survol, cause de blocage visible, état des boutons préservé après annulation, attente de la sauvegarde, absence de succès trompeur. Les notes/photos restent secondaires ; aucun champ administratif nouveau n'est imposé.

**Utilisation à une main — déduction :** les gros boutons et l'absence de tableau global sont favorables. La longueur d'une consigne peut néanmoins repousser Ensuite sous le premier écran ; il faut privilégier la consigne courante et garder les détails secondaires repliés. La validation réelle doit porter sur lecture debout, interruptions et retour après verrouillage du téléphone. Aucune affirmation « moins de 5 secondes garanti » n'est justifiée par un test responsive seul.

Fleetio documente l'exécution mobile des ordres de travail avec tâches et informations associées. La leçon transposable est le contexte de l'ordre et l'action au même endroit ; ce n'est pas une recommandation d'achat ou de remplacement de NIMR. [Fleetio — Work orders in Fleetio Go](https://help.fleetio.com/en_US/work-orders-in-fleetio-go)

# 18. Ce qu'il faut supprimer

**Retiré dans la v35 :**

1. Le balisage et le rendu des anciennes files Aujourd'hui masquées, concurrents de la liste unifiée.
2. L'association « durée restante non nulle = reprendre » pour un travail neuf.
3. L'affichage d'une opération jamais commencée comme travail actuel d'un technicien.
4. Le « Non affecté » actuel quand seul le prochain travail est affecté.
5. La confusion « sans tâche active = disponible maintenant ».
6. La remise à zéro du statut pièces par le bouton de retrait d'un blocage.
7. La substitution d'une échéance atelier à la promesse ou au rappel client.
8. Les succès technicien/CQ/livraison annoncés avant confirmation de la sauvegarde locale.
9. La réactivation générale des boutons technicien après annulation.
10. Les filtres CQ inapplicables et la conservation d'un filtre d'un autre utilisateur.
11. Le passage imposé au dossier complet pour consulter une carte Équipe ou régler les pièces.
12. Le rendu qui remplace sans nécessité les cartes et fait perdre le focus.

**À retirer seulement après vérification d'usage et des dépendances :** l'accès quotidien Atelier/Ressources du chef au premier niveau ; les répétitions résiduelles du résumé complet ; les champs commerciaux ressaisis alors que l'ERP/document les fournit ; les fonctions historiques réellement sans appel. Le périmètre UI et le nettoyage technique doivent être distingués.

**À ne pas ajouter :** un écran Garantie autonome sans volume démontré ; un Kanban concurrent des phases existantes ; un nouveau moteur de tickets pour les exceptions ; un nouveau statut par raison de blocage ; une batterie KPI sur l'écran technicien ; un ERP miniature ; un glisser-déposer pour paraître moderne. La simplification de l'existant suffit à la majorité des besoins examinés.

# 19. Ce qu'il ne faut surtout pas casser

| Invariant | Preuve et validation pertinente |
|---|---|
| Une famille métier peut avoir plusieurs segments sans devenir plusieurs opérations | `canonical_task_model_p1003` ; agrégation par tâche métier |
| Dépendances, déterminisme et liens source restent cohérents | `workshop_001b_dependency_dag` : 34 scénarios ; gauche/droite et identifiants source entre ordres conservés |
| Préparation et peinture gardent leurs règles protégées | Garde du préfixe métier de référence et scénarios peinture du DAG |
| Calendrier/capacité et acceptation de planning restent contrôlés | `planning_acceptance_safety_p1002` : 46 contrôles internes de la suite |
| Le pointage concerne les droits et l'affectation du technicien | `technician_flow`, `canonical_roles_statuses_v236` |
| Un import ne vaut pas accord ; présence ne vaut pas RDV | `workshop_operational_simplification`, `audit_completion` |
| CQ rejeté ne peut être masqué par une ancienne approbation | `quality_controller_role_v235`, `operational_coherence` |
| Fin travaux, Prêt et Livré restent distincts | `operational_coherence`, `audit_completion_browser`, `reception_delivery_sheet_v231c` |
| Un dossier clôturé/facturé conserve ses verrouillages | `close_invoice_hard_lock_v2302` |
| Une coupure réseau ne doit pas perdre l'action locale | `indexeddb_outbox_runtime_p0012`, `granular_sync_outbox_p009`, `mobile_offline_recovery` |
| Une révision distante ne doit pas être écrasée silencieusement | `offline_concurrency_chaos_p010`, nouvelle garde de révision du panneau |
| Une mise à jour ne mélange pas les versions d'assets | `pwa_deploy_asset_version_consistency_cache001`, `pwa_cache_version_contract`, `release_fingerprint_portability` |

**Recette exécutée :** `node tests/run-audit-release.mjs`, 24 fichiers de tests, **36 résultats Node TAP passés, 0 échec**, environ 71 s lors de l'exécution de référence. Le comptage TAP n'est pas la somme des assertions internes : plusieurs fichiers exécutent leur propre batterie. La nouvelle suite `operational_coherence` contient 13 scénarios ciblés. Les trois largeurs navigateur et l'enchaînement CQ → remise passent.

Performance DAG observée sur ce poste : médianes 1,89 / 5,17 / 10,74 / 16,96 ms pour 10 / 30 / 60 / 100 lignes ; seuil existant de médiane < 25 ms conservé. Le maximum ponctuel à 100 lignes atteint 25,88 ms ; ne pas présenter le seuil de médiane comme une garantie de latence maximale. Aucun assouplissement de seuil n'a été fait.

**Tests historiques :** des suites plus anciennes scellent des fichiers entiers d'une version précédente. Leur invocation initiale sur la base v34 a montré des échecs de snapshots déjà présents ; elles ne sont pas réécrites pour masquer la différence. La recette courante vérifie comportements, invariants et empreinte de release. L'empreinte scellée v34 reste immuable ; une entrée v35 est ajoutée. Ce rapport ne prétend pas que chaque fichier de test historique du dépôt passe sur toute version future.

**Supabase et UX.** L'interface doit distinguer mutation en mémoire, écriture locale durable, envoi en attente et accusé serveur. Attendre `saveState` ne prouve pas, à lui seul, la réception sur tous les postes. Le transport Realtime sert à propager des changements, pas à remplacer le traitement de concurrence et les confirmations de persistance. [Supabase — Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

La v35 n'introduit ni table, ni RPC, ni migration. Elle réutilise les champs et les gardes existants, ajoute une protection contre les décisions depuis un panneau devenu ancien, et fiabilise le retour de sauvegarde. Les tests de sync sont isolés ; ils ne valent pas une inspection complète des politiques RLS, comptes et données de la base en production pendant cette mission.

# 20. Score actuel vs cible

Notes de revue sur 10, **base actuelle auditée v34** comparée à la cible. Une note haute signifie une meilleure simplicité/efficacité, y compris pour « charge cognitive » et « nombre de clics ». La colonne livraison précise l'effet constaté du code v35 ; aucun score après déploiement n'est artificiellement présenté comme une mesure utilisateur.

| Axe | v34 | Cible | Justification et effet de la v35 |
|---|---:|---:|---|
| Simplicité globale | 6,5 | 8,5 | Bonne architecture émergente ; contradictions et détours. V35 consolide les décisions courantes. |
| Clarté navigation | 7,5 | 9 | Rôles déjà différenciés ; accès ressources/atelier encore quotidien pour chef. |
| Lisibilité | 7 | 9 | Cartes cohérentes ; volume du dossier complet reste élevé. Motifs et intitulés clarifiés v35. |
| Efficacité Chef Atelier | 6,5 | 9 | Tour de contrôle présente, faux actuel/disponible coûteux. Corrections et raccourcis v35. |
| Efficacité Réception | 7 | 9 | Situation client utile ; échéances et périmètre attendus/pré­sents fiabilisés. |
| Efficacité Technicien | 8 | 9,5 | Une surface, deux actions en cours. Gardes visibles et retour d'action fiable v35. |
| Efficacité Directeur | 7 | 8,5 | Pilotage disponible ; besoin d'une sélection plus nette des décisions de direction. |
| Visibilité véhicule | 7 | 9,5 | Une carte existe ; Prêt, suite et affectation corrigés v35. |
| Visibilité activité technicien | 6,5 | 9 | Différence prévu/réel/disponible corrigée. |
| Gestion des exceptions | 6 | 9 | Règles utiles mais collisions échéances et faux signaux ; v35 traite ces causes. |
| Planification | 8,5 | 9 | Moteur riche protégé ; simplifier surtout ses points d'accès et ses explications. |
| Mobile | 8 | 9 | Responsive testé ; terrain réel à observer. |
| Charge cognitive | 6,5 | 9 | Trop de conventions de statut ; six phases et une action pertinente doivent suffire. |
| Nombre de clics | 7 | 9 | Exécution déjà courte ; pièces, équipe et planning rapprochés dans v35. |
| Traçabilité | 8,5 | 9 | Historique/accord/sync riches ; ne pas supprimer les confirmations nécessaires. |
| Cohérence des statuts | 6 | 9,5 | Prêt et action de remise divergeaient ; gardes partagées v35. |
| Séparation des rôles | 8 | 9 | Navigation déjà différenciée ; responsabilités support/directeur à formaliser par usage. |
| Qualité du cockpit atelier | 7 | 9,5 | Bonne base ; la qualité dépend de la véracité des informations plus que de nouvelles tuiles. |

La cible n'est pas « 10 partout ». Une plateforme d'atelier garde une complexité incompressible : absence, supplément, reprise, contrôle rejeté et conflit de synchronisation doivent rester traitables sans mensonge de simplification.

# 21. Roadmap de simplification

Les phases ci-dessous distinguent les corrections livrées et les décisions qui exigent une preuve d'usage. Elles ne constituent pas une promesse de nouveaux modules.

### QUICK WINS — très faible risque

**Livré v35 :** comptage présents/attendus, libellé reprise, titulaire de la prochaine opération, filtres rapides, échéances client préservées, retrait des files masquées, redirection du lanceur local obsolète. Validation : scénarios ciblés et recette navigateur.

### PHASE S1 — simplification structurelle UX

**Livré v35 :** panneau opérationnel commun aux cartes véhicule/équipe, accès pièces/blocage et planning ciblé, maintien du focus, préparation/contrôle et Prêt cohérents. **Cible à valider :** retirer les répétitions résiduelles du dossier complet et déplacer Ressources dans un accès secondaire. Critère de décision : le retrait réduit le repérage sans faire perdre une action fréquemment utilisée.

### PHASE S2 — workspaces par rôle

**Déjà présent en v34 :** accueil par rôle et technicien unique. **Livré v35 :** pertinence CQ, priorisation réception, réinitialisation des filtres au changement d'utilisateur. **Cible à valider :** trois entrées directeur, quatre chef et libellés Véhicules/Mon travail ; file support conservée sans rôle neuf. Critère : réussir les questions 5/30 secondes avec une personne de chaque métier.

### PHASE S3 — management by exception

**Livré v35 :** alertes client/atelier séparées, échéance de décision dépassée, blocage de tâche isolé visible, stagnation liée à l'atelier et dépassement actif mieux défini. **À calibrer sur usage :** seuil de stagnation en heures ouvrées, niveau des alertes et couverture du filtre support. Critère : examiner les faux positifs/faux négatifs avant toute notification supplémentaire.

### PHASE S4 — optimisations secondaires

Mesurer la recopie ERP, tester avec de vrais téléphones, observer la fréquence d'ajustement du planning et nettoyer seulement les fonctions dont les appels sont établis comme absents. Une intégration, un drag & drop ou une nouvelle vue doivent prouver qu'une simplification de l'existant ne suffit pas. Il n'y a pas de nécessité démontrée de les développer dans cette livraison.

# 22. Les 10 changements au meilleur ROI

Classement qualitatif, sans jours gagnés inventés. Les dix sont couverts par les modifications de la v35.

1. **Un seul calcul de Prêt aligné sur la remise autorisée.** Très faible volume de code, forte réduction des annonces contradictoires.
2. **Un retour d'action honnête.** Attente de sauvegarde, boutons protégés, dialogues conservés : confiance quotidienne et récupération d'incident.
3. **Séparer promesse, rappel et décision atelier.** Empêche qu'un suivi interne déplace silencieusement une obligation client.
4. **Séparer Maintenant, Ensuite et Disponible.** Réduit les erreurs d'affectation et de lecture de capacité.
5. **Pièces/blocage depuis le véhicule d'Aujourd'hui.** Réduit les détours, avec conservation des causes et du statut pièces.
6. **Empêcher une décision depuis un panneau devenu ancien.** Petite garde locale qui complète les contrôles de concurrence existants.
7. **Compter présence et attente séparément.** Corrige une lecture de charge physique sans ajouter un indicateur.
8. **Faire ressortir la bonne exception pour le rôle.** Moins de recherche, sans cacher les autres problèmes.
9. **Un seul accès contextuel depuis véhicule et équipe.** Réduit la navigation et garde la continuité de l'action.
10. **Supprimer les anciens rendus et stabiliser les cartes/filtres.** Moins de travail inutile et de surprises pendant une interaction.

# 23. Proposition finale de NIMR-SAV simplifié

Le matin, la réception ouvre Aujourd'hui. Elle distingue les voitures attendues des voitures physiquement présentes. Pour une arrivée, elle récupère l'identité depuis le document ou saisit le minimum, indique le motif et confirme la présence. Elle ne reconstitue pas les lignes d'un devis déjà importé et ne prétend pas que l'import vaut accord.

Le chef ouvre le même espace, avec l'équipe. Il choisit À traiter, lit cause, responsable et échéance, ouvre le panneau et règle les informations de pièces ou de décision. S'il faut réorganiser la capacité, il ouvre directement le planning du véhicule. Les cas normaux restent lisibles sans réclamer une action de sa part.

Le technicien voit son véhicule et l'opération réelle. Si elle peut démarrer, il démarre. Sinon, la première condition manquante est écrite. Pendant le travail, il a Pause et Terminer ; une anomalie ouvre une saisie courte liée à cette intervention. L'application enregistre l'heure et l'acteur. Le travail suivant reste une prévision tant que ses conditions ne passent pas.

La réception consulte la disponibilité estimée et la compare à la promesse réellement enregistrée. Elle sait quand rappeler et marque le client informé. Un retard n'est pas effacé par le recalcul du planning. Le support intervient dans les dossiers qui nécessitent son expertise, avec le même historique, pas une deuxième base documentaire.

À la fin des travaux, le CQ trouve sa file. Il valide les contrôles applicables ou motive l'anomalie. La voiture n'est Prête que lorsque les conditions de remise sont satisfaites. La réception confirme ensuite la remise physique ; le dossier sort de la file des présents, mais sa trace demeure.

Le directeur regarde capacité, engagements menacés et problèmes nécessitant son arbitrage. Il peut approfondir ; il n'est pas obligé de parcourir chaque dossier ni de décider la prochaine tâche de chaque technicien. Les tendances servent à améliorer l'organisation, séparément du rythme des opérations.

La v35 rend cette journée plus cohérente dans l'outil existant. Le changement complet de nomenclature de navigation, la calibration sur horaires ouvrés et la validation chronométrée en atelier restent des éléments de cible explicitement distincts du code livré.

# 24. Verdict final

**Si j'étais Directeur SAV demain matin, je demanderais avant toute nouvelle fonctionnalité :** une présence physique exacte ; une opération actuelle réellement commencée ; une disponibilité technicien justifiée ; une promesse client jamais réécrite par le planning ; un Prêt conforme aux gardes de livraison ; une décision courante accessible depuis Aujourd'hui ; un retour d'action qui ne promet pas une sauvegarde absente ; un responsable et une échéance pour les vraies exceptions.

Ce sont les points traités par la v35, en conservant le moteur de planification, les dépendances, l'autorisation, la traçabilité et le contrat PWA. Je ne demanderais ni refonte React, ni nouveau module garantie, ni tableau supplémentaire de KPI pour obtenir cette amélioration.

Ensuite, je ferais observer les parcours par les personnes qui utilisent réellement l'atelier : une arrivée sans devis, une pièce absente, un supplément, une reprise, un CQ refusé, une promesse menacée et une coupure réseau. Les menus ou champs encore inutiles seraient retirés sur cette base. **La réussite se mesure à la justesse de la prochaine action et à l'absence de ressaisie, pas au nombre d'écrans supprimés.**

Repères de vérification dans la version livrée : `js/state.js` (`isCaseReadyForDelivery`, `getCaseFinalizationIssues`) ; `js/ui-cases.js` (`getCaseNextAction`, `getOperationalExceptions`, `guardVisibleCaseRevision`, `openOperationalCasePanel`, `handleTechnicianTaskAction`, `renderOperationalDecisions`, `renderCaseBlockerControls`) ; `tests/operational_coherence.test.mjs` ; `tests/audit_completion_browser.test.mjs` ; `tests/run-audit-release.mjs`. La note `RELEASE-v23.3.35.md` consigne le périmètre technique et la validation de la version.
