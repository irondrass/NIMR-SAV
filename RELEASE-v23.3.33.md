# NIMR-SAV v23.3.33 — corrections opérationnelles

Copie concernée : `__github_publish_NIMR_SAV`, site https://irondrass.github.io/NIMR-SAV/.

## Changements livrés

- Les véhicules réceptionnés restent présents dans le suivi jusqu’à leur remise physique, y compris si un ancien dossier est clôturé, facturé ou archivé. Un dossier archivé incohérent affiche un avertissement et reste protégé contre l’édition.
- Les phases affichées distinguent Attendu, À préparer, En intervention, À finaliser, Prêt et Livré. L’accueil commence par les véhicules présents, puis l’équipe ; les anciennes files sont repliables.
- Le démarrage vérifie l’accord explicite de chaque ordre concerné. La réception peut saisir la référence de cet accord. Le simple statut importé « approuvé » ne suffit pas.
- Le contrôle final et la remise du véhicule disposent de boutons dédiés. Travaux non terminés, blocages, opérations restantes et réclamations ouvertes empêchent la finalisation locale. La clôture/archivage attend la remise physique.
- Les techniciens ont des actions principales Pause/Terminer, un volet Problème/note/photo et un volet Date/impression. Les motifs ne sont plus préremplis arbitrairement. La reprise d’un blocage demande de confirmer sa résolution et revérifie les prérequis.
- Les estimations sont masquées lorsqu’un blocage ou une pause les rend incertaines. Les attributs HTML `hidden` sont respectés malgré les règles CSS des composants.
- La synchronisation métier est distincte des boutons d’administration Supabase. Les techniciens synchronisent les faits canoniques sans réécrire les fiches client/véhicule. Les contrôleurs qualité utilisent une API limitée à la décision qualité, sans transmission du dossier complet.

## Supabase

La migration `20260905230951_operational_finalization_quality_sync.sql` a été exécutée sur le projet de production `mkecnwolvzgxltrasbmr` par l’éditeur SQL authentifié.

- Refus explicite (`false`, jamais `NULL`) lorsqu’un utilisateur n’a pas le rôle atelier requis. Cette correction protège aussi les anciens appels SQL qui utilisent `IF NOT`.
- Contrôles serveur des nouvelles décisions qualité, de la remise physique et de la clôture/archivage. Pas de réécriture massive des dossiers historiques.
- API qualité v2 avec contrôle de version et reprise idempotente. La lecture privilégiée des reçus reste dans `nimr_internal`, derrière un contrôle explicite d’identité et de rôle. Aucune ouverture de la table des reçus aux utilisateurs.
- Les règles existantes des tables clients, véhicules et ordres restent inchangées. Le document canonique reste la référence de l’application ; les projections relationnelles ne sont réécrites que par les rôles autorisés.

`tests/operational_supabase_verification.sql` a été exécuté avec succès en production : absence d’appartenance, refus anonyme, confidentialité des reçus, clôture prématurée, travaux inachevés, décision obsolète, validation autorisée, préservation des champs hors qualité et répétition idempotente. Les données fictives ont été annulées par `ROLLBACK`.

## Validation

- 17 suites ciblées ont été validées pendant cette livraison : métier, technicien, rôles, modèle canonique, dépendances, concurrence, synchronisation, planning, index, empreinte, démarrage PWA, cache et sécurité/accessibilité.
- Après le dernier ajustement des projections technicien, les 8 suites affectées ont été relancées : 8/8 réussies, dont les 49 scénarios du cache, les 42 contrôles sécurité/accessibilité et les 10 contrôles de démarrage PWA.
- Vérification visuelle et interaction réelle sur un aperçu local isolé, sans connexion Supabase : écran technicien à 390 × 844, dialogue de pause, contrôle qualité. Une validation qualité produit « Prêt / Véhicule présent » et ne donne pas au contrôleur le bouton de livraison.
- Les versions et ressources du cache sont alignées sur v23.3.33. Les empreintes historiques sont conservées. v23.3.32 correspond au candidat local antérieur au dernier contrôle des droits, non publié dans cette livraison.

## Limites et travail restant

La suite historique complète n’est pas entièrement verte : sa première exécution a donné 163 succès et 59 échecs sur 222 tests. Elle contient notamment des assertions figées sur d’anciennes versions, sur l’absence de contrôle qualité/accord client, sur l’immuabilité de fichiers désormais modifiés, ainsi que des harnais navigateur en expiration CDP et des fixtures PDF indisponibles. Ce bilan ne constitue pas une validation exhaustive de tous les anciens scénarios. Les tests métier smoke et technicien ont été adaptés aux nouvelles règles ; les autres échecs ne sont pas masqués.

L’Advisor Center Supabase signale encore des avertissements hérités, dont les anciennes fonctions `SECURITY DEFINER` exposées, l’extension `btree_gist` dans public et la protection contre les mots de passe divulgués désactivée. Le refus d’accès indéterminé a été corrigé et testé ; la réorganisation complète des anciennes API reste une intervention séparée.

Cette livraison couvre les correctifs prioritaires et une simplification des écrans. Elle ne prétend pas réaliser toute la refonte décrite dans l’audit : modèle explicite d’heure promise au client, regroupement complet des opérations PDF, écran de création minimal et nettoyage général des anciennes interfaces restent à traiter.
