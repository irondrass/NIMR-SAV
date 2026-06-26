# Backlog de Rattrapage de Parité — NIMR SAV React v24

Ce backlog détaille la feuille de route (roadmap) découpée en lots de développement pour ramener la nouvelle application React à parité fonctionnelle stricte avec l'ancienne version pilote stable (v23.2.6).

> [!IMPORTANT]
> **Notes sur la v24.0.0-alpha.15 :**
> - Le lot **alpha.15** couvre uniquement multi-sinistres / claims / accords expert & client.
> - La version alpha.15 **n'est pas une RC** (Release Candidate) et **n'est pas destinée à la production** (le pilote stable reste la v23.2.6).
> - Le lot **alpha.14** reste le lot dédié au planning avancé et Gantt.
> - Le lot **alpha.16** reste le lot import devis.
> - Le lot **alpha.17** reste impressions/exports.
> - Le lot **alpha.18** reste offline/PWA (React sans Service Worker actif actuellement).
> - Le lot **Cloud/Supabase** reste entièrement séparé.

---

## Lot alpha.14 : Planning Atelier Avancé & Gantt

### Objectif
Restaurer l'intelligence algorithmique et visuelle du planning pour permettre au Chef d'Atelier de gérer l'atelier de manière proactive, sans conflit d'affectation.

### Fonctions Incluses
* **Suggestion Automatique de Créneau** : Algorithme `generateAppointmentOptions` proposant les 3 meilleurs créneaux de dépôt/livraison.
* **Capacité des Ressources & Équipements** : Profils de ressources avec rôles (Peintre, Tôlier...), jours ouvrés, cabines de peinture, ponts mécanique/vidange.
* **Détection de Collisions** : Alerte ou blocage visuel rouge si deux tâches sont planifiées en parallèle pour le même technicien ou équipement.
* **Diagramme Gantt d'Atelier** : Composant de visualisation graphique des tâches et des absences par ressource sur la journée.
* **Vue Jour/Semaine** : Sélecteur de date pour naviguer dans le planning atelier.
* **Préparation Anticipée des Pièces Neuves** : Jalonnement parallèle de la préparation pièces neuves si la tôlerie est en cours et qu'un peintre est disponible.

### Fonctions Exclues
* Importation de devis chiffrés (saisie manuelle temporaire des durées de tâches dans le planning).
* Suspension avec motifs techniciens avancés (traitée dans le Lot alpha.18).

### Critères d'Acceptation
1. La sélection d'un véhicule affiche une liste de créneaux suggérés libres de toute collision.
2. Une affectation simultanée sur le même technicien lève une erreur visuelle bloquante.
3. Les jours fériés et congés apparaissent en zones grisées non planifiables sur le Gantt.
4. L'immatriculation réelle sans préfixe `DEMO-` est acceptée (Désactivation de `validateFictiveFields` pour ce lot).

### Tests Nécessaires
* **Tests unitaires** : Collision engine (`src/domain/collision-engine.ts`), Suggestions de créneaux (`src/domain/appointment-scheduler.ts`).
* **Tests d'intégration** : Validation des conflits d'affectations via Vitest (`tests/scheduling-collisions.test.ts`).

### Risques
* **Complexité de l'UI Gantt** : Rendre le diagramme fluide et réactif en pur React sans alourdir le DOM.
* **Performance** : Calcul des créneaux sur 60 jours en cas de volume important de réservations dans le localStorage.

### Décision GO / NO-GO
* **GO** si la détection de collisions bloque à 100% les doublons et que le Gantt affiche correctement les tâches.

---

## Lot alpha.15 : Multi-sinistres (Claims) & OR Multiples

### Objectif
Permettre de gérer plusieurs sinistres / ordres de réparation (Claims) indépendants pour un seul véhicule, avec leurs propres statuts et accords.

### Fonctions Incluses
* **Structure OR Multiples** : Champ `claims` (array d'objets `claim`) rattaché à l'entité `SavCase`.
* **Statuts Indépendants par Sinistre** : Chaque sinistre peut être au statut *expertApproved*, *clientApproved*, ou *pending*.
* **Accords Expert et Client** : Boutons de validation d'accords sur chaque carte de sinistre.
* **Règles d'Avancement du Dossier Global** : L'avancement vers la planification exige que tous les sinistres inclus aient un devis et les accords correspondants.

### Fonctions Exclues
* Importation automatique des devis par fichier (les lignes de devis par sinistre sont saisies à la main pour ce lot).

### Critères d'Acceptation
1. L'utilisateur peut ajouter 2 sinistres différents sur le même véhicule (ex. Un sinistre Assurance, un Sinistre Client direct).
2. L'accord expert n'est requis et affiché que pour les sinistres de type "Assurance".
3. Le bouton de planification du véhicule reste verrouillé tant qu'un sinistre inclus est en attente d'accord.

### Tests Nécessaires
* **Tests d'intégration** : Scénarios multi-sinistres et règles de transition dans `tests/multi-claims-workflow.test.ts`.

### Risques
* **Complexité du modèle de données** : Risque de désynchronisation entre le statut global du dossier véhicule et les statuts locaux des différents claims.

### Décision GO / NO-GO
* **GO** si le workflow global se bloque correctement dès qu'au moins un sinistre actif n'est pas approuvé.

---

## Lot alpha.16 : Import Devis & Calcul Charge Atelier

### Objectif
Permettre l'intégration automatique des devis d'assurance (HTML/TXT) pour éliminer la saisie manuelle et répartir automatiquement la charge par pôle.

### Fonctions Incluses
* **Importateur Devis** : Module de téléversement et de lecture de fichiers devis.
* **Extraction Automatique des Heures** : Parseur regex pour extraire la main-d'œuvre et catégoriser les phases de travaux (Tôlerie, Préparation, Peinture...).
* **Calcul de Charge Atelier** : Conversion des heures de devis en minutes de charge estimées rattachées aux tâches du planning.
* **Filtres & KPIs de Charge** : Alertes de surcharge atelier pour le directeur SAV.

### Fonctions Exclues
* Génération de fiches d'impression (traitée dans le Lot alpha.17).

### Critères d'Acceptation
1. Le téléversement d'un fichier de devis brut extrait les montants exacts et les lignes de main-d’œuvre.
2. Les heures de main-d'œuvre sont correctement injectées dans les tâches d'atelier associées.
3. Le score de santé opérationnelle du directeur SAV intègre le taux de surcharge des postes.

### Tests Nécessaires
* **Tests de non-régression** : Réimportation de la suite de tests de devis de la v23 (`tests/estimate-import-parser.test.ts`).

### Risques
* **Variabilité des formats de devis** : Le parseur regex doit être tolérant aux sauts de ligne et encodages.

### Décision GO / NO-GO
* **GO** si le taux de succès d'importation sur les 15 cas de test types est de 100%.

---

## Lot alpha.17 : Impressions & Exports ZIP/PDF

### Objectif
Garantir la continuité de service en fournissant des documents de travail physiques et les dossiers complets requis pour la facturation des compagnies d'assurance.

### Fonctions Incluses
* **Génération PDF Native** : Création de documents de jalon (Fiche de réception, Ordre de Réparation, Rapport QC, PV de Restitution).
* **Impression Physique** : Styles CSS `@media print` sur les fiches de tâches techniciens et le planning jour.
* **Export ZIP Complet** : Compilation côté client d'une archive ZIP contenant le dossier photos classé par catégorie et tous les rapports PDF.

### Fonctions Exclues
* Sauvegardes distantes sur serveur d'archives (le ZIP est téléchargé localement par le navigateur).

### Critères d'Acceptation
1. L'utilisateur peut imprimer une fiche papier lisible pour n'importe quelle tâche d'atelier.
2. Le PV de restitution contient des zones pour la signature physique du client et les réserves.
3. L'export ZIP télécharge un fichier valide contenant les images dans des répertoires nommés (`before/`, `during/`, `after/`).

### Tests Nécessaires
* **Tests unitaires** : Validation du générateur ZIP (`src/domain/zip-exporter.ts`).
* **Vérification visuelle** : Rendu papier des feuilles de style d'impression.

### Risques
* **Limite mémoire du navigateur** : Risque de crash ou de lenteur lors de la compilation ZIP si le dossier contient 50+ photos haute résolution.

### Décision GO / NO-GO
* **GO** si l'archive ZIP générée s'ouvre sans erreur sur Windows/Mac et contient tous les PDFs requis.

---

## Lot alpha.18 : Mode Offline & Gestion locale

### Objectif
Assurer l'accès à l'application et la saisie des données sur les tablettes d'atelier même en cas de coupure ou d'instabilité du réseau Wi-Fi local.

### Fonctions Incluses
* **Service Worker React** : Mise en cache contrôlée des bundles JS/CSS et des assets d'interface.
* **Indicateur de Statut de Connexion** : Notification claire du passage en mode hors-ligne.
* **Persistance localStorage Robuste** : Gestion de la réécriture locale et sécurisation contre les corruptions de données.
* **Suspension avec Motif & Reliquat Technicien** : Permet au technicien en atelier de suspendre localement sa tâche et de planifier la reprise.

### Fonctions Exclues
* Synchronisation automatique multi-utilisateurs cloud (traitée dans le lot suivant).

### Critères d'Acceptation
1. L'application se charge et reste utilisable lorsque le mode avion est activé sur la tablette.
2. Les saisies faites hors-ligne sont conservées en localStorage et ne sont pas perdues au rafraîchissement.

### Tests Nécessaires
* **Tests de robustesse offline** : Vérification du cycle de vie du Service Worker.

### Risques
* **Mises à jour de cache (PWA)** : Risque que les utilisateurs conservent une ancienne version du code en cache (version cache collision).

### Décision GO / NO-GO
* **GO** si le rechargement hors-ligne de la page d'accueil affiche l'interface fonctionnelle.

---

## Lot Post-Alpha : Synchronisation & Sécurité Cloud

### Objectif
Connecter l'application React au backend cloud pour centraliser les dossiers et assurer la synchronisation en temps réel entre tous les postes (Réception, Atelier, Direction).

### Fonctions Incluses
* **Connecteur Supabase Client** : Initialisation et requêtes d'API distantes.
* **Détection et Résolution de Conflits** : Interface visuelle pour fusionner les révisions locales (`localRevision`) et distantes (`syncRevision`).
* **Gouvernance RLS (Row Level Security)** : Contrôle d'accès aux tables Supabase en fonction du rôle de session utilisateur.
* **Verrouillage de Production post-Clôture** : Protection stricte en écriture des dossiers facturés.

### Critères d'Acceptation
1. Une modification faite sur le poste Réception apparaît sous 3 secondes sur l'écran du Chef d'Atelier.
2. En cas de conflit (modification simultanée hors-ligne), l'utilisateur est invité à choisir la version à conserver via une modale dédiée.

### Tests Nécessaires
* **Tests d'intégration réseau** : Simulation de latence et de déconnexions transitoires.

### Risques
* **Conflits de données massifs** : Risque d'écrasement de données si les révisions locales ne sont pas incrémentées avec rigueur.

### Décision GO / NO-GO
* **GO** si la synchronisation préserve les modifications de l'atelier sans perte de données.
