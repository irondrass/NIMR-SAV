# v22.04 - KPI SAV dans le pilotage

- Ajout d'un bloc KPI SAV dans l'onglet Pilotage : RDV du jour, réceptions en retard, véhicules atelier, travaux en cours, qualité à traiter, livraisons à risque, accords complets et délai moyen estimé.
- Restauration de la zone d'alertes SAV dans Pilotage, au-dessus du Kanban.
- Cache PWA incrémenté en v22.04.

# v22.03 - Anticipation pièces neuves verrouillée par capacité réelle

- La préparation anticipée des pièces neuves est annulée si le peintre ou la zone de préparation sont occupés pendant la fenêtre de démarrage de la tôlerie.
- Correction de cohérence PWA : `index.html`, `app.js` et `sw.js` pointent tous vers la version v22.03 et le nettoyage conserve le `CACHE_NAME` réel.
- Cache PWA incrémenté en v22.03.

# v22.02 - Préparation anticipée conditionnelle des pièces neuves

- Suppression de toute étape séparée de peinture anticipée.
- La préparation anticipée des pièces neuves est créée uniquement si un peintre et une zone de préparation sont libres au démarrage de la tôlerie.
- Si la capacité n’est pas libre, le planning garde le flux normal.
- Cache PWA incrémenté en v22.02.

# v21.98 - Vérification dernière archive et correction import

- Correction de regex corrompues dans l'import devis à la création : les limites de mots `\b` sont restaurées pour mieux détecter type d'ordre, numéro devis, numéro OR, VIN, immatriculation, téléphone et kilométrage.
- Rétablissement de l'onglet interne `Photos`, dont le panneau existait encore mais n'était plus accessible dans la navigation du dossier.
- L'enregistrement du service worker pointe maintenant vers `sw.js?v=21.97`.
- Cache PWA incrémenté en v21.98 pour forcer la prise en compte de la mise à jour.

# v21.91 - Verrouillage livraison et validation MO renforcés

- Les accords expert/client refusent maintenant les devis qui ne contiennent aucune heure de main-d’œuvre réelle, même si une ligne existe à 0 h.
- La livraison vérifie désormais toute la chaîne concessionnaire : RDV, réception physique, démarrage, fin travaux, affectation atelier et contrôle qualité.
- Ajout de tests de régression sur les devis à 0 h et les dossiers importés/incohérents qui tentaient de passer directement en livraison.
- Cache PWA incrémenté en v21.91.

# v21.89 - Flux atelier concessionnaire corrigé

- Ajout d’une étape métier explicite `Travaux terminés` entre `Démarrer travaux` et `Contrôle qualité`, afin d’éviter une validation qualité alors que la production n’est pas clôturée.
- Livraison assurance bloquée tant qu’aucune photo `Après réparation` n’est jointe au dossier.
- Nettoyage d’un doublon `includeInPlanning` dans la normalisation des ordres.
- Export dossier enrichi avec l’état `Travaux terminés`.
- Synchronisation Supabase et statut dossier mis à jour pour distinguer `in_progress`, `work_completed`, `quality_approved` et `delivered`.
- Cache PWA incrémenté en v21.89.

# v21.88 - Flux atelier concessionnaire renforcé

- Correction du flux d’accords : les boutons globaux accord expert / accord client valident maintenant les ordres de réparation inclus, au lieu de rester bloqués par leur propre prérequis.
- Le calcul de RDV vérifie les accords réellement portés par les ordres de réparation, pas seulement les anciens drapeaux globaux du dossier.
- Ajout de la conservation des observations de réception (`arrivalNotes`) et affichage dans la carte réception.
- Cache PWA incrémenté en v21.88.

# v21.76 - Heure complète dans les tâches Gantt

- Le badge horaire du planning Gantt affiche maintenant toujours l’heure complète quand la tâche est assez large.
- Le badge de numéro reste séparé de l’heure.
- Les tâches trop courtes gardent seulement le numéro de tâche, sans texte tronqué.
- Le cache PWA est incrémenté en v21.76.

# v21.75 - Badge numéro séparé de l’heure Gantt

- Le numéro de tâche n’est plus superposé au badge horaire.
- Sur une tâche lisible, l’heure reste en haut à droite et le numéro se place en bas à droite.
- Sur une tâche trop courte, seul le numéro de tâche reste centré dans la carte.
- Le cache PWA est incrémenté en v21.75.

# v21.75 - Badges seuls pour tâches courtes Gantt

- Les tâches trop étroites dans le planning n’affichent plus de texte tronqué avec « ... ».
- Elles affichent uniquement le numéro de tâche, avec détail disponible au survol et dans la liste d’impression.
- Le cache PWA est incrémenté en v21.74.

# v21.74 - Impression Gantt lisible avec tâches courtes

- Ajout de badges numérotés sur chaque tâche du Gantt imprimé.
- Ajout d’une liste détaillée des tâches sous le Gantt pour retrouver les créneaux trop courts.
- Les tâches de petite durée restent visibles même si leur barre est étroite.
- Le cache PWA est incrémenté en v21.74.

## v21.74
Correction de l’impression du planning journalier afin que les tâches courtes restent exploitables sur A4 paysage.


## v21.80
- Correction du rechargement automatique des nouvelles versions PWA : stratégie network-first pour l'application, activation immédiate du nouveau service worker et rechargement sécurisé après autosave d'urgence.
- Ajout d'un contrôle de sauvegarde automatique dans Atelier > Sauvegarde : principal, miroir local, snapshots, dernière sauvegarde cloud.
- Ajout des actions Télécharger copie de sécurité et Restaurer dernier point automatique.


## v21.80

- Ajout du script `supabase-create-repair-claims.sql` pour creer uniquement les tables manquantes `repair_claims` et `repair_claim_labor_lines`.
- Messages Supabase mis a jour pour demander le schema v21.80.
- Cache PWA incremente pour forcer le rechargement de la mise a jour.
