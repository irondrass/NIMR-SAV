# NIMR-SAV v23.3.35 — décisions atelier cohérentes

6 septembre 2026. Base : v23.3.34, `3ed0c084db0e433ae70c07209e2a31d4df618e6a`.

Une ancienne validation CQ pouvait faire afficher « Prêt » malgré un nouvel obstacle à la remise. La phase et le bouton de livraison utilisent maintenant les gardes de finalisation existantes. Les opérations prévues sont distinguées des opérations réellement commencées ; le titulaire de la prochaine opération apparaît à la bonne place et la disponibilité tient compte des contraintes existantes.

Depuis Aujourd'hui, les cartes véhicule et équipe ouvrent le même panneau : décisions, pièces/blocage, engagement client et accès au planning du véhicule. Présents et attendus sont comptés séparément, les filtres courants sont directs, le CQ reçoit les filtres pertinents et les cartes conservent leur focus lors des actualisations.

Les échéances de décision atelier ne remplacent plus les promesses et rappels client. Les alertes distinguent activité atelier et échange client, blocage avant démarrage, pause et dépassement actif. Un panneau devenu ancien refuse une décision sur une révision remplacée.

Les actions technicien et de finalisation attendent la sauvegarde locale avant d'annoncer un succès. Annuler une action conserve les boutons désactivés par leurs gardes. Fermer un panneau pendant la sauvegarde ne supprime plus le dialogue de confirmation partagé. Retirer un blocage ne remet plus les pièces à « non vérifié » et exige la résolution explicite d'une pénurie.

## Périmètre

Modifications fonctionnelles dans `js/ui-cases.js` et un sélecteur de disponibilité à la remise dans `js/state.js`, éléments d'interface dans `index.html`/`styles.css`, métadonnées PWA alignées sur v23.3.35. Aucun changement de schéma ou de RPC Supabase, aucune réécriture du moteur planning/DAG/peinture, aucun nouveau statut persistant.

Le lanceur du dossier local parent dirige également vers le dépôt maintenu. Ce fichier parent n'appartient pas au dépôt publié. L'ancien rapport local du 5 septembre reste préservé.

## Validation

- `node tests/run-audit-release.mjs` : 24 fichiers, 36 résultats Node TAP passés, 0 échec ; environ 71 s.
- 13 nouveaux scénarios `operational_coherence` ; parcours navigateur réception → CQ → remise et mobile 360/390/430 px.
- 46 scénarios de sécurité d'acceptation planning et 34 scénarios DAG, garde de peinture protégée.
- Médianes DAG 10/30/60/100 lignes : 1,89 / 5,17 / 10,74 / 16,96 ms ; seuil de médiane existant < 25 ms inchangé.
- Permissions, verrouillage, outbox, conflits hors connexion, reprise PWA, version/cache et portabilité d'empreinte couverts par la recette.
- `git diff --check` et vérification de syntaxe JavaScript sans erreur.

Les profils mobiles sont simulés dans Chromium ; aucun chronométrage de salariés ni test avec téléphone physique n'est revendiqué. Les tests historiques de versions scellées restent distincts de la recette courante ; leurs références anciennes ne sont pas réécrites.

Empreinte des 23 fichiers runtime, schéma `canonical-lf-v2` :

`65f6f4dc4a9a87bb3fd34517c04e0db827f6611fb1822cdaa1655040449d1bcd`

L'entrée scellée v34 est conservée. La v35 reçoit sa propre identité, ses URL d'assets et son cache. L'écriture locale confirmée ne signifie pas encore accusé serveur : l'état global de synchronisation reste la référence de transport.

## Audit complet

Le rapport `docs/audit-ux-metier-2026-09-06.md` contient les 24 sections demandées, les 20 frictions classées, les matrices par rôle, les sources de vérité, les règles d'alerte, les scores de revue et la distinction entre changements livrés et cible à valider en atelier.
