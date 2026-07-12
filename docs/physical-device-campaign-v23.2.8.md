# Campagne appareils physiques — v23.2.8-full-audit

Statut actuel : **NON EXÉCUTÉE**.

Les tests Chromium automatisés du dépôt utilisent des profils d’écran et d’entrée simulés. Ils ne constituent pas une preuve sur Android, iPhone, iPad, Safari iOS, réseau cellulaire ou PWA installée. Ce document prépare la campagne humaine sans la déclarer validée.

## Matrice obligatoire

| Support | Navigateur / mode | Portrait | Paysage | PWA installée | Hors ligne / reprise | Statut |
|---|---|---:|---:|---:|---:|---|
| Android 360–430 px | Chrome stable | À faire | À faire | À faire | À faire | NON TESTÉ |
| iPhone SE | Safari iOS | À faire | À faire | À faire | À faire | NON TESTÉ |
| iPhone 13 / Pro Max | Safari iOS | À faire | À faire | À faire | À faire | NON TESTÉ |
| iPad Mini / 10 pouces | Safari iPadOS | À faire | À faire | À faire | À faire | NON TESTÉ |
| Tablette Android 800×1280 | Chrome stable | À faire | À faire | À faire | À faire | NON TESTÉ |
| Poste atelier 1366×768+ | Chrome / Edge | N/A | N/A | Facultatif | À faire | NON TESTÉ |

## Parcours à exécuter sur chaque appareil

1. Noter appareil, OS, navigateur, version, date, testeur et build affiché `v23.2.8-full-audit`.
2. Ouvrir l’application, se connecter avec un compte de test du bon atelier et vérifier le rôle serveur.
3. Importer un devis PDF de test autorisé, contrôler l’aperçu, créer le dossier et valider les tâches Chef Atelier.
4. Réserver le planning puis vérifier qu’un second appareil ne peut pas prendre la même ressource au même horaire.
5. Ouvrir l’espace technicien : tâche actuelle, prochaine tâche, zone, début réel, fin estimée et chronomètre doivent rester lisibles sans défilement horizontal.
6. Tester Débuter, Pause, Reprendre, Blocage, Observation et Terminer sans photo ; vérifier que la photo reste facultative.
7. Passer hors ligne, effectuer une action autorisée, fermer ou mettre l’application en arrière-plan, puis revenir en ligne. Contrôler l’ordre de rejeu, l’absence de doublon et l’état de l’outbox.
8. Verrouiller/déverrouiller l’écran, forcer la fermeture, relancer la PWA, puis vérifier le dossier, la tâche active et le chronomètre.
9. Basculer portrait/paysage, ouvrir le clavier sur les champs texte et vérifier safe areas, modales, barre d’adresse et actions fixes.
10. Tester zoom/police agrandie et confirmer des cibles tactiles d’au moins 44×44 px sur les actions terrain.
11. Se déconnecter puis se reconnecter ; vérifier dossiers, ressources, réservations, conflits et dernière confirmation serveur.
12. Relever `console.error`, `pageerror`, captures avant/après, opération serveur et éventuel conflit.

## Critères de validation

- zéro perte de donnée et zéro double réservation ;
- zéro double session technicien et zéro double comptage de temps ;
- aucune action masquée par navigation, clavier, encoche ou barre système ;
- zéro `console.error` et zéro `pageerror` ;
- reprise PWA et offline idempotente ;
- données identiques après déconnexion/reconnexion et sur un second poste ;
- preuve associée à chaque ligne de la matrice (capture, horodatage, appareil, résultat).

La campagne ne pourra passer à **VALIDÉE** qu’après exécution et signature humaines sur les appareils listés.
