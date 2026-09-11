# Reprise de l'audit terrain — candidat v23.3.40

Date : 9 septembre 2026. Statut : branche publiée sur GitHub ; [PR #65](https://github.com/irondrass/NIMR-SAV/pull/65) en état DRAFT, revue distante disponible ; aucune fusion ni mise en production.

## Base et préservation des changements utilisateur

SCOPE: V23 LEGACY. SUPABASE IMPACT: NONE (aucune modification SQL, RLS, Auth, Edge Function ou configuration serveur dans cette reprise).

Base vérifiée sur `origin/main` : `269bcf535bc314f9fd1e9dd8c050559972ae19e8`, v23.3.39. La reprise inclut les évolutions déjà fusionnées : import des devis et liaison des comptes (v36), autorisation explicite des travaux (v37), authentification hors ligne (v38), gestion des conflits de synchronisation (v39).

Branche : `fix/field-audit-continuation-v2339`. Dossier de travail : `NIMR-SAV-FIELD-AUDIT-CONTINUATION`. Les modifications préexistantes du dossier `__github_publish_NIMR_SAV` sont conservées ; aucune copie des anciens fichiers applicatifs sur la nouvelle base. Aucune modification du code React.

L'audit initial reste une observation des écrans et des documents. Cette phase utilise la lecture ciblée du code, expressément autorisée par l'utilisateur après l'audit. L'authentification du transport Git et du navigateur a permis la publication de la branche et la création de la PR #65 ; la revue distante est disponible malgré le problème antérieur de GitHub CLI.

## Changements intégrés

### Absences

L'absence est enregistrable même si des tâches occupent déjà la période. La liste montre les travaux à traiter et mène directement au dossier concerné. Elle distingue les tâches commencées et non commencées. Les réservations, pointages et promesses ne sont pas modifiés automatiquement. Les tâches terminées, annulées, supprimées ou les anciennes portions déjà remplacées par une reprise ne créent pas de faux impacts.

Les périodes inversées, ressources absentes/inactives et absences en double sont refusées. Le sélecteur propose uniquement les rôles humains affectables. L'enregistrement et le retrait vérifient la sauvegarde locale et laissent un historique. Un retrait demande confirmation de la remise à disposition de la personne.

Alternative minimale retenue : liste des travaux concernés et réorganisation individuelle. Une absence à fin indéterminée n'a pas encore son propre état avec rappel automatique ; l'écran demande la période connue et une réévaluation avant sa fin. La réaffectation par lot n'est pas intégrée.

### Retards et reprises

Le temps réalisé provient des sessions réellement démarrées et peut dépasser la durée prévue. Les sessions qui se chevauchent ne sont pas comptées deux fois. Les fermetures du calendrier sont exclues, avec conservation des segments explicitement réservés hors horaires. Aucune durée travaillée n'est déduite d'une réservation jamais démarrée.

Une pause après consommation du temps prévu produit une reprise à estimer et à planifier, au lieu d'inventer quelques minutes restantes. La reprise conserve le lien avec l'opération, les lignes source, les dépendances et les contraintes de ressources. Elle ne peut pas démarrer avant estimation et affectation. L'estimation de disponibilité reste « à confirmer » si une reprise attend sa planification. L'estimation et le déplacement réutilisent le contrôle de disponibilités et de dépendances existant.

### Diagnostics et réclamations

Un diagnostic peut avoir une durée totale inconnue. Un créneau d'investigation représente une capacité réservée, sans promettre la résolution à son terme. L'ajout d'une investigation supplémentaire à un dossier déjà planifié conserve les travaux et pointages précédents ; la nouvelle tâche attend l'affectation du Chef Atelier. Une conclusion est requise avant finalisation d'un diagnostic encore ouvert.

Le suivi client, accessible depuis la carte et le dossier complet, conserve plusieurs sujets distincts. Chaque sujet ouvert possède un responsable actif, une prochaine action et une date de revue. La clôture exige une conclusion, un compte rendu et la confirmation que le client a été informé. « Suite refusée », « Non reproduit », « Hors périmètre » et « Résolu » restent distincts. Une réouverture conserve l'historique. Les revues échues apparaissent dans les points à traiter.

Les erreurs du formulaire apparaissent dans le formulaire, y compris sur mobile. Les champs de clôture sont affichés seulement lorsque l'état choisi les rend utiles. La confirmation de sauvegarde distingue la mémoire locale d'une sauvegarde durable. Aucun message n'est envoyé au client automatiquement.

### Impressions

Sept sorties HTML imprimables utilisent le format A4, des en-têtes de tableaux répétés, une identité de document et une pagination CSS : ordre de réparation, ordres techniciens, planning tableau, planning Gantt, fiche de tâche, fiche de pause/blocage, ordre complémentaire.

Les documents atelier retirent les téléphones et informations d'assurance non nécessaires à l'exécution. Les opérations et heures utiles restent visibles. Les pièces importées manifestement issues d'un champ d'identité sont filtrées à l'impression sans modifier les données du dossier ; les vraies pièces, dont plaquettes et supports de châssis, restent présentes. Le Gantt sépare les techniciens des équipements, dont l'annexe est facultative, et conserve les proportions de durée.

Les fichiers PDF anciens et les quatre maquettes du 6 septembre restent inchangés. Les sept fichiers de recette sont des HTML générés par le code corrigé avec des données fictives. Ils ne constituent pas encore une validation de pagination PDF dans le navigateur. Les exports PDF texte du ZIP d'archive ne sont pas refondus dans ce lot.

## Vérification et preuves

Commandes exécutées depuis le dossier de travail de cette branche. Les journaux complets sont conservés hors du dépôt, dans `../audit-terrain-2026-09-06/`.

| Vérification | Résultat |
|---|---|
| Régressions VM, 28 fichiers via `node ../audit-terrain-2026-09-06/run-continuation-checks.mjs .` | 115 résultats TAP réussis, 0 échec, code 0 ; journal `continuation-regressions.log` |
| Régressions nouvelles absences/reprises | 8 tests réussis, dont reprise estimée à 45 minutes sans changement des pointages antérieurs |
| Régressions nouvelles diagnostic/suivi client | 6 tests réussis, dont ajout d'investigation préservant une tâche terminée |
| Régressions nouvelles impressions | 10 tests réussis, 7 modèles ; contenu échappé, vrai article conservé, fausses identités retirées |
| Cache/version : `node --test --test-concurrency=1 tests/pwa_deploy_asset_version_consistency_cache001.test.mjs tests/pwa_cache_version_contract.test.mjs tests/release_fingerprint_portability.test.mjs` | 3 fichiers réussis, 49 scénarios cache, 10 contrôles de portabilité ; journal `continuation-release-checks.log` |
| `node --check` sur app, state, planning, ui-cases, ui-planning, exports et sw | Aucun diagnostic, succès |
| `git diff --check` | Succès |
| `node tests/workshop_001b_dependency_dag.test.mjs` | 34 scénarios fonctionnels et garde de l'optimiseur réussis ; benchmark 60 lignes en échec, médiane 41,5316 ms pour un seuil de 25 ms ; code 1, journal `continuation-dag.log` |
| Comparaison du benchmark sur la base intacte v39 | Même échec observé, médiane 41,5164 ms ; le seuil et l'optimiseur n'ont pas été modifiés |

Les fixtures de deux tests existants (smoke et technicien) ont été corrigées pour démarrer effectivement la session à l'heure du scénario. Elles ne confondent plus réservation passée et pointage réalisé. Leurs assertions métier restent conservées. Les tests du cache suivent les identités précédente/courante/future v39/v40/v41 ; les empreintes des versions antérieures restent identiques.

Empreinte de la nouvelle version : `0250bc08b36c1d77ee557c7ce16f6623e3f8bcfc8514dd5287e7bbb428beee81`, schéma `canonical-lf-v2`, 23 fichiers de runtime. Les 7 fichiers déclarant une version utilisent v23.3.40.

Recette visuelle locale : rôle Chef Atelier, enregistrement d'une absence recouvrant une tâche, affichage du travail concerné et accès au dossier avec alerte d'absence ; suivi client mobile avec refus de clôture incomplète puis clôture explicite « Suite refusée par le client » et confirmation visible. Les aperçus des sept impressions sont examinés avec des données de démonstration. Aucun dossier client réel, pointage réel, absence réelle ou conflit Supabase n'a été modifié pendant cette reprise.

## Limites de validation et conditions de publication

GATE: suite navigateur automatisée complète | STATUS: NOT RUN | REASON: les harnais CDP/Playwright directs du dépôt ne sont pas exécutés dans cet environnement ; interactions navigateur réalisées par l'outil CUA | RISK: hors-ligne, rotation mobile et reprise PWA ne sont pas revalidés de bout en bout ici.

GATE: PDF réellement exportés | STATUS: NOT RUN | REASON: aperçu HTML disponible, export natif PDF non accessible à l'automatisation courante | RISK: nombre de pages, coupures et marges finales doivent être vérifiés dans les PDF du navigateur.

PDF PAGINATION: NOT VERIFIED — les sept aperçus HTML existent ; les PDF natifs restent en attente d'export et de revue par l'utilisateur.

GATE: performance DAG | STATUS: FAIL | REASON: seuil dépassé également sur la base intacte | RISK: fusion bloquée par la règle locale de qualité à 100 %. Aucun seuil n'a été assoupli.

GATE: revue distante | STATUS: AVAILABLE | REASON: PR #65 publiée sur GitHub, état DRAFT, HEAD f5f8fb4a4764f4d2b3901ef6a377b611a87cc7aa | RISK: branche disponible pour revue, sans fusion ni mise en production ; les conditions de validation restent distinctes.

GATE: liaison compte-technicien en production | STATUS: NOT VERIFIED | REASON: la fonction Edge déjà livrée dans v36 n'a pas été redéployée ni vérifiée avec un compte administrateur durant cette reprise | RISK: distinguer présence du bouton local et liaison réellement persistée côté Supabase.

Ne pas qualifier la recette complète ni la production de validée. Avant fusion : traiter l'échec de performance ou obtenir une dérogation explicite à la règle de qualité, compléter les contrôles navigateur/PDF et vérifier la CI. Après publication : mettre à jour les postes avant utilisation des nouveaux champs, vérifier la version servie, le cache actif et la conservation du suivi après synchronisation entre deux rôles. Les anciens imports erronés requièrent une correction métier dossier par dossier pour préserver les pointages et preuves.

## Rapport avant commit

La modification porte sur le problème observé et ses parcours associés. Les anciennes évolutions utilisateur, la politique d'autorisation des travaux, le transport Supabase et les règles de conflits restent inclus dans la base. Aucun nettoyage, suppression de branche, réécriture d'historique ou modification de données réelles n'a eu lieu.

Conclusion de revue locale : candidat à un commit et à une revue de branche, pas à une fusion automatique tant que les gates ci-dessus restent ouverts. Le récapitulatif `git diff --stat`, le contrôle syntaxique et le contrôle d'espaces ont été examinés avant le commit. Les sources PDF privées ne sont pas ajoutées au dépôt.
