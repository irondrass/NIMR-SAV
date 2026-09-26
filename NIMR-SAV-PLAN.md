# NIMR-SAV — PLAN DE DÉVELOPPEMENT

Version de référence : 26/09/2026

Ce document contient uniquement le plan spécifique au projet NIMR-SAV.

Les règles générales de gouvernance Claude / Codex / PowerShell sont définies dans les règles globales du workspace NIMR et ne doivent pas être dupliquées ici.

---

# 1. OBJECTIF DU PROJET

NIMR-SAV doit devenir une application SAV automobile :

- fiable ;
- simple à utiliser ;
- cohérente avec le fonctionnement réel d'un atelier automobile ;
- sécurisée ;
- traçable ;
- maintenable ;
- testée de bout en bout ;
- adaptée aux responsabilités de chaque rôle ;
- prête pour une utilisation réelle en production.

Le développement doit privilégier :

- le workflow réel atelier ;
- la simplicité d'utilisation ;
- la sécurité serveur ;
- la traçabilité ;
- les preuves techniques ;
- la réduction des doubles saisies ;
- la limitation des actions inutiles.

---

# 2. ARCHITECTURE À RESPECTER

Le projet comporte deux générations applicatives.

## V23

Application legacy Vanilla JS / PWA à la racine du dépôt.

## V24

Application React située dans :

`apps/nimr-sav-react/`

Toute tâche doit préciser sa cible.

Ne pas modifier V23 et V24 simultanément sans besoin explicite.

Ne jamais supposer qu'une fonctionnalité présente dans une génération existe dans l'autre.

---

# 3. ÉTAT DE RÉFÉRENCE QC-PRO-001

Le dernier audit de référence a confirmé les points suivants.

## CONFIRMÉ

### Autorité QC

Le contrôleur qualité affecté constitue l'autorité prioritaire.

Le Chef Atelier peut intervenir uniquement comme fallback autorisé selon les règles prévues.

L'auto-affectation est interdite.

### Boucle NOK

La logique SQL prévoit correctement :

`NOK → retouche → QC#2`

La branche de rejet ne déclenche pas la finalisation normale.

### Checklist

La checklist UI et serveur était alignée sur 51 clés dans l'audit de référence.

### Problème de câblage identifié

Au commit de référence audité :

`index.html`

ne chargeait pas :

`js/ui-reception.js`

alors que cet élément est nécessaire au rendu du contrôle qualité professionnel.

Le correctif existait localement mais n'était pas encore intégré dans le commit audité.

### Risque sécurité

Le mécanisme :

`nimr_04_quality_domain_authority`

doit être vérifié lorsque :

`auth.uid() IS NULL`

notamment dans les contextes utilisant `service_role`.

### E2E

Le harness E2E E9B6L / R5 / R5.1 n'avait pas encore produit un verdict complet.

Les blocages rencontrés étaient liés au harness / PowerShell et non à un verdict métier définitif.

---

# 4. PRINCIPE POUR QC-PRO

Ne pas reconstruire l'architecture QC si elle reste saine.

Priorité :

1. terminer le câblage ;
2. sécuriser les éventuels contournements ;
3. obtenir un vrai verdict E2E ;
4. corriger uniquement les défauts démontrés ;
5. fermer le lot.

---

# 5. GATE 0 — QC-PRO-001

## Objectif

Obtenir un verdict réel :

`QC-PRO-001 : GO`

sur la base de preuves techniques et E2E.

## Travail restant à vérifier

### 5.1 Câblage frontend

Vérifier que :

`js/ui-reception.js`

est réellement chargé par l'application utilisée.

Vérifier que les anciens éléments devenus inutiles ont été retirés si nécessaire.

Ne pas conclure uniquement à partir du code source :
contrôler le comportement réel dans le navigateur.

### 5.2 Harness E2E

Fiabiliser le harness existant.

Réutiliser :

`cdp_browser_harness.mjs`

si cela reste la meilleure solution après inspection.

### 5.3 Scénario E2E obligatoire

Exécuter sur staging :

`NOK → retouche → QC#2 → validation → livraison`

Le test doit couvrir les vraies transitions et les permissions associées.

### 5.4 Identité utilisateur

Les tests d'autorisation doivent utiliser un vrai utilisateur / JWT.

Ne jamais utiliser `service_role` pour simuler un utilisateur normal.

### 5.5 Autorité serveur

Vérifier précisément :

`nimr_04_quality_domain_authority`

et rechercher tout contournement exploitable lorsque :

`auth.uid() IS NULL`

### 5.6 Critère de sortie

Gate 0 est fermé uniquement si :

- frontend réellement câblé ;
- scénario E2E complet PASS ;
- autorisations serveur vérifiées ;
- absence de contournement critique connu ;
- diff final revu ;
- tests pertinents PASS ;
- review Claude terminée.

Verdict attendu :

`QC-PRO-001 : GO`

---

# 6. LOT 1 — PRELEVEMENT-AUDIT-001

## Objectif

Créer / auditer le workflow de prélèvement atelier généraliste.

Ce module est distinct de VN-PART.

## VN-PART

VN-PART concerne les pièces prélevées sur un véhicule neuf donneur.

Workflow déjà distinct :

`EN_ATTENTE_VALIDATIONS`
→
`AUTORISE_A_PRELEVER`
→
`PRELEVE_EN_ATTENTE_PIECE`
→
`PIECE_DISPONIBLE`
→
`RESTITUE_AU_VN`
→
`CLOTURE`

Ne pas fusionner ce workflow avec le prélèvement atelier généraliste.

## Prélèvement atelier généraliste

Le modèle de données doit permettre de distinguer explicitement :

- `requested_qty`
- `approved_qty`
- `reserved_qty`
- `picked_qty`
- `issued_qty`
- `returned_qty`

## Principes attendus

- aucune validation partielle silencieuse ;
- quantité retournée ≤ quantité réellement délivrée ;
- motif obligatoire pour toute annulation après réservation ;
- traçabilité des approbations ;
- traçabilité des mouvements ;
- distinction demande / réservation / picking / délivrance / retour ;
- UX magasinier adaptée tablette ;
- scan code-barres à étudier.

## Références externes à revalider

- OCA `stock-logistics-workflow`
- ERPNext Stock
- InvenTree

Ces références servent à étudier les patterns.

Leur existence, leur fonctionnalité et leur licence doivent être revérifiées avant toute décision d'ingénierie.

---

# 7. LOT 2 — SEC-AUDIT-001

## Objectif

Auditer la sécurité de l'application et de la chaîne d'autorité.

## Première priorité

Rechercher tout équivalent du problème :

`auth.uid() IS NULL`

dans :

- RLS ;
- triggers ;
- fonctions `SECURITY DEFINER` ;
- RPC ;
- fonctions d'autorité ;
- routes backend ;
- usages `service_role` ;
- tests ;
- scripts d'administration.

## Contrôles

Vérifier notamment :

- escalade de privilège ;
- modification directe d'état ;
- contournement client ;
- fonctions serveur exposées ;
- RLS incohérentes ;
- droits excessifs ;
- service-role utilisé hors contexte d'administration ;
- différence frontend / serveur.

Les outils automatiques peuvent assister l'audit mais ne remplacent pas la revue manuelle.

---

# 8. LOT 3 — SAV-INTELLIGENCE-001

## Objectif

Construire les indicateurs de pilotage SAV à partir des données NIMR.

## WIP

Mesurer les OR / véhicules réellement en cours.

## Aging

Mesurer le temps passé dans les étapes :

`réception`
→
`diagnostic`
→
`validation`
→
`pièces`
→
`travaux`
→
`QC`
→
`prêt livraison`

## Comeback

Identifier les retours atelier après intervention précédente lorsque le lien technique est pertinent.

Éviter les faux comeback.

## KPI

Les KPI doivent servir à une action réelle.

Ne pas créer un KPI uniquement parce qu'il est facile à calculer.

Exemples de finalités :

- détecter blocages ;
- identifier retards ;
- mesurer charge atelier ;
- détecter manque de pièces ;
- suivre qualité ;
- suivre délais ;
- prioriser les dossiers.

---

# 9. LOT 4 — PLANNING-OPT-001

## État actuel

Le planning NIMR possède déjà un moteur de règles métier mature.

Il inclut notamment des logiques de :

- continuité technicien ;
- spécialité ;
- équipements ;
- retard planifié ;
- planning mobile ;
- horaires / équipes atelier.

Il ne faut pas remplacer ce moteur.

## Architecture cible

`Règles métier NIMR`
→
`contraintes`
→
`OR-Tools CP-SAT`
→
`solutions candidates`
→
`scoring NIMR`
→
`proposition Chef Atelier`

L'optimiseur propose.

Le Chef Atelier conserve l'autorité opérationnelle.

## Limite V1

Ne pas introduire de :

- RL ;
- GNN ;
- architecture de recherche complexe ;

sans justification démontrée.

---

# 10. LOTS REPORTÉS

## TECH-KNOWLEDGE-001

REPORTÉ.

## AI-SAV-001

REPORTÉ.

Ne pas ouvrir ces lots tant que :

- les modules fondamentaux ne sont pas stabilisés ;
- les données internes ne sont pas suffisantes ;
- le besoin métier n'est pas démontré ;
- les références externes pertinentes ne sont pas revérifiées.

---

# 11. DOUBLE GÉNÉRATION V23 / V24

Le risque de divergence V23 / V24 doit être surveillé à chaque lot.

Pour chaque nouvelle fonctionnalité :

- préciser la génération cible ;
- ne pas créer involontairement deux implémentations divergentes ;
- ne pas modifier l'autre génération sans raison ;
- documenter si la parité est nécessaire ou non.

---

# 12. RÈGLE POUR LES RÉFÉRENCES EXTERNES

Toute référence externe entrant dans une décision NIMR-SAV doit être vérifiée.

Avant utilisation :

- existence réelle ;
- fonctionnalité réellement présente ;
- pertinence ;
- maturité ;
- activité ;
- licence.

Une référence non vérifiée reste :

`NON VÉRIFIÉ`

et ne peut pas devenir un fait d'audit.

---

# 13. SCOPE CONTROL

Toute nouvelle découverte doit être classée :

- `BLOCKER`
- `À CORRIGER DANS LE LOT`
- `BACKLOG`
- `IDÉE FUTURE`
- `NON PERTINENT`

Ne pas ouvrir un nouveau chantier uniquement parce qu'une amélioration supplémentaire est possible.

La priorité est de terminer proprement le lot courant.

---

# 14. ORDRE DE TRAVAIL OFFICIEL

Sauf décision explicite contraire :

1. `QC-PRO-001`
2. `PRELEVEMENT-AUDIT-001`
3. `SEC-AUDIT-001`
4. `SAV-INTELLIGENCE-001`
5. `PLANNING-OPT-001`

Puis seulement, si leur besoin est confirmé :

6. `TECH-KNOWLEDGE-001`
7. `AI-SAV-001`

---

# 15. DÉMARRAGE D'UNE SESSION

À la reprise du projet :

1. lire les règles globales applicables ;
2. lire ce fichier ;
3. vérifier le dépôt réel ;
4. vérifier branche / HEAD / working tree ;
5. identifier les changements non commités ;
6. lire `.nimr-ai\last-run.txt` s'il existe ;
7. lire uniquement les logs détaillés nécessaires ;
8. vérifier l'état exact du lot courant ;
9. choisir le plus petit prochain travail permettant d'avancer vers le GO.

Pour le lot actuel :

`QC-PRO-001 — Gate 0`

---

# 16. CONDITION GÉNÉRALE DE GO PRODUCTION

Un lot n'est pas terminé parce que :

- le code compile ;
- une migration existe ;
- un bouton s'affiche ;
- un test isolé passe.

Un lot est terminé lorsque :

- le workflow réel fonctionne ;
- les rôles sont corrects ;
- les autorisations serveur sont correctes ;
- les transitions interdites sont bloquées ;
- les erreurs pertinentes sont gérées ;
- les tests nécessaires passent ;
- le diff a été revu ;
- les régressions critiques ont été écartées ;
- les preuves sont suffisantes pour le verdict.

---

# 17. PROCHAINE PRIORITÉ

Priorité immédiate :

`QC-PRO-001 — Gate 0`

Objectif :

obtenir enfin une preuve E2E complète du scénario :

`NOK → retouche → QC#2 → validation → livraison`

puis rendre :

`QC-PRO-001 : GO`

ou documenter précisément le dernier blocker restant.
