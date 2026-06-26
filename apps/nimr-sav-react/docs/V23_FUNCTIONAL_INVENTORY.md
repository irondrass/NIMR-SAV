# Inventaire Fonctionnel Complet — NIMR SAV v23.x (Racine)

Ce document recense l'intégralité des fonctionnalités métier implémentées dans la version pilote stable/pilote actuelle (v23.2.6) de l'application racine.

---

## 1. Module Réception

### Fonction : Saisie & Qualification Dossier Véhicule
* **Description** : Création d'un dossier véhicule avec les informations administratives libres (sans contrainte de démo).
* **Fichier source** : `js/ui-reception.js` (fonction `renderStep1_Creation`, `handleReceptionFormSubmit`, `handleCreateCase`)
* **Boutons/Champs** : Formulaire client, Immatriculation, VIN, Modèle, Kilométrage, Téléphone, Presets motifs de prise en charge (boutons rapides).
* **Données utilisées** : Objet `caseItem` normalisé dans `state.cases`.
* **Rôle concerné** : Réceptionnaire, Chef d'Atelier, Directeur SAV, Admin.
* **Importance terrain** : **P0 (Bloquant)** — Point d'entrée de tous les véhicules.
* **Dépendances** : `js/state.js` (`normalizeCase`).
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Qualification de la Réception Physique
* **Description** : Confirmation de l'arrivée physique du véhicule à l'atelier, avec capture des notes de réception (`arrivalNotes`).
* **Fichier source** : `js/ui-reception.js` (fonction `renderStep7_VehicleReceived`, `handleReceptionFormSubmit`)
* **Boutons/Champs** : Bouton "Confirmer Réception Physique", zone de texte "Observations de Réception".
* **Données utilisées** : `caseItem.flags.received` (booléen), `caseItem.arrivalNotes` (string), `caseItem.receptionWorkflow.vehicleReceivedAt` (ISO DateTime).
* **Rôle concerné** : Réceptionnaire, Admin.
* **Importance terrain** : **P0** — Le démarrage des travaux exige la réception physique préalable.
* **Dépendances** : `js/state.js` (`normalizeCase` avec fusion `receptionNotes` / `arrivalNotes`).
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Suivi du Workflow de Réception à 11 Étapes
* **Description** : Barre de progression décomposant le parcours client de la création à la livraison.
* **Fichier source** : `js/ui-reception.js` (`renderReceptionStepBar`, `renderReceptionActiveStep`)
* **Boutons/Champs** : Étapes 1 à 11 interactives pour les rôles autorisés.
* **Données utilisées** : `caseItem.receptionWorkflow`.
* **Rôle concerné** : Réceptionnaire.
* **Importance terrain** : **P1** — Permet de suivre visuellement où en est le dossier client.
* **Dépendances** : `js/ui-reception.js` (fonctions d'étapes `renderStep1_Creation` à `renderStep11_Delivery`).

---

## 2. Module Multi-sinistres / Claims

### Fonction : Gestion Multi-sinistres (Claims/Ordres de Réparation)
* **Description** : Permet d'attacher un ou plusieurs sinistres ou ordres (claims) distincts à un même dossier de véhicule (ex: Sinistre Assurance A + Réparation Client directe).
* **Fichier source** : `js/state.js` (`normalizeRepairClaims`, `normalizeRepairClaim`), `js/ui-reception.js` (`renderCustomerClaimsBlock`)
* **Boutons/Champs** : Bouton "Ajouter une réclamation / sinistre", liste des sinistres avec statut.
* **Données utilisées** : `caseItem.claims` (array d'objets `claim`).
* **Rôle concerné** : Réceptionnaire, Directeur SAV, Chef d'Atelier, Admin.
* **Importance terrain** : **P0** — Cœur de la logique de carrosserie multi-payeurs.
* **Dépendances** : `js/state.js`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Approbations Distinctes Expert et Client par Sinistre
* **Description** : Synchronisation des drapeaux de validation de devis par sinistre : accord expert (requis pour assurance) et accord client (requis pour planification).
* **Fichier source** : `js/state.js`, `js/ui-cases.js`
* **Boutons/Champs** : Boutons "Valider Accord Expert" et "Valider Accord Client" sur les cartes de sinistres.
* **Données utilisées** : `claim.expertApproved`, `claim.clientApproved`.
* **Rôle concerné** : Réceptionnaire, Directeur (pour override).
* **Importance terrain** : **P0** — Sécurise la facturation et évite de planifier des travaux non accordés.
* **Dépendances** : `js/business-rules-v2187.js`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

---

## 3. Module Import Devis

### Fonction : Analyseur (Parser) de Devis Chiffrés HTML/TXT
* **Description** : Téléversement et lecture automatique d'un fichier de devis pour extraire les données HT/TVA/TTC, les pièces de rechange et la main-d’œuvre.
* **Fichier source** : `js/estimate-import.js` (`parseEstimateText`, `handleEstimateImportFile`)
* **Boutons/Champs** : Bouton "Importer Devis (PDF/TXT/XLSX)" sur le sinistre.
* **Données utilisées** : `claim.estimate` (lignes de devis).
* **Rôle concerné** : Réceptionnaire.
* **Importance terrain** : **P0** — Gain de temps majeur. Évite la saisie manuelle de dizaines de lignes.
* **Dépendances** : `js/business-rules-v2187.js` (pour classer et affecter les durées de main-d’œuvre par pôle).
* **Test existant** : `tests/estimate_regression.mjs`

### Fonction : Classification Automatique de la Main-d'œuvre par Pôle
* **Description** : Analyse des libellés du devis importé pour les classer dans les phases de production (Tôlerie, Préparation, Peinture, Remontage, Finition).
* **Fichier source** : `js/business-rules-v2187.js` (`classifyLaborLine`, `optimizeEstimateAllocationsFromOriginalLines`)
* **Boutons/Champs** : Interface interactive d'ajustement des checkboxes par phase.
* **Données utilisées** : `estimate.lines.selectedPhases`, durées associées.
* **Rôle concerné** : Réceptionnaire, Chef d'Atelier.
* **Importance terrain** : **P0** — Calcule la charge atelier réelle.
* **Dépendances** : `js/business-rules-v2187.js`.
* **Test existant** : `tests/estimate_regression.mjs`

---

## 4. Module Planning / Réservation

### Fonction : Réservation Automatique et Suggestion de Créneau
* **Description** : Calcule les créneaux disponibles pour l'ensemble du cycle de réparation selon la charge actuelle de l'atelier sur un horizon de 60 jours.
* **Fichier source** : `js/planning.js` (`generateAppointmentOptions`, `findBestResourceSlot`)
* **Boutons/Champs** : Liste des 3 meilleures propositions de dates de dépôt et de livraison à la sélection.
* **Données utilisées** : `state.bookings`, `state.resources`.
* **Rôle concerné** : Réceptionnaire.
* **Importance terrain** : **P0** — Permet de donner un rendez-vous fiable immédiatement au client.
* **Dépendances** : `js/planning.js` (algorithmes de collision).
* **Test existant** : `tests/audit.test.mjs`

### Fonction : Gestion Fine de la Capacité Atelier (Ressources & Postes)
* **Description** : Modélise les heures d'ouverture de l'atelier, les ponts (mécanique/vidange), les cabines de peinture, et l'affectation nominative aux compagnons.
* **Fichier source** : `js/planning.js`, `js/ui-planning.js` (`renderWorkHoursSettings`, `renderHolidays`, `renderResourceLeaves`)
* **Boutons/Champs** : Paramètres de planning, saisie des absences compagnons.
* **Données utilisées** : `state.resources` (active, role, leaves, calendar).
* **Rôle concerné** : Chef d'Atelier, Admin.
* **Importance terrain** : **P1** — Évite les surcharges et prend en compte les congés.
* **Dépendances** : `js/planning.js`.
* **Test existant** : `tests/audit.test.mjs`

### Fonction : Détection de Collisions et Résolution de Conflits
* **Description** : Empêche d'affecter deux tâches en parallèle au même compagnon ou d'occuper une ressource déjà planifiée ou en congé.
* **Fichier source** : `js/planning.js` (`findConflict`, `getResourceLeaveConflicts`)
* **Boutons/Champs** : Messages d'alerte, indicateur visuel de collision rouge dans le planning.
* **Données utilisées** : `booking.resourceIds`.
* **Rôle concerné** : Chef d'Atelier.
* **Importance terrain** : **P0** — Évite les goulots d'étranglement physiques.
* **Dépendances** : `js/planning.js`.
* **Test existant** : `tests/audit.test.mjs`

### Fonction : Diagramme Gantt Interactif
* **Description** : Visualisation temporelle complète de la journée de l'atelier par ressource.
* **Fichier source** : `js/ui-planning.js` (`renderPlanning`, `renderResourceBookings`, `renderTicks`)
* **Boutons/Champs** : Grille temporelle Gantt, barres colorées représentatives des tâches et congés.
* **Données utilisées** : `state.bookings` filtrées par jour.
* **Rôle concerné** : Chef d'Atelier, Directeur SAV.
* **Importance terrain** : **P1** — Cockpit de pilotage de l'atelier.
* **Dépendances** : `js/ui-planning.js`.
* **Test existant** : Aucun (validation visuelle).

### Fonction : Routage Intelligent "Service Rapide" (Fast Lane)
* **Description** : Les interventions courtes (devis inférieur au seuil, par exemple 4h) sont priorisées et routées sur la "Fast Lane" de l'atelier sans perturber les grands travaux.
* **Fichier source** : `js/planning.js` (`isFastLaneJob`), `js/ui-planning.js` (`renderFastLaneSettings`)
* **Boutons/Champs** : Configuration du seuil d'heures Fast Lane.
* **Données utilisées** : `state.fastLaneThresholdHours`.
* **Rôle concerné** : Chef d'Atelier.
* **Importance terrain** : **P1** — Performance opérationnelle.
* **Dépendances** : `js/planning.js`.
* **Test existant** : `tests/audit.test.mjs`

### Fonction : Préparation Anticipée des Pièces Neuves
* **Description** : Génération d'une tâche de préparation anticipée pour les pièces neuves en parallèle de la tôlerie pour gagner du temps, sous réserve de ressources disponibles.
* **Fichier source** : `js/planning.js` (`getAnticipatedNewPartPlanningSplit`, `schedulePipelineWithAnticipatedNewParts`)
* **Boutons/Champs** : Case à cocher "Pièce neuve" dans l'analyse de devis.
* **Données utilisées** : `estimate.lines.newPart`.
* **Rôle concerné** : Chef d'Atelier.
* **Importance terrain** : **P1** — Optimisation du temps de cycle.
* **Dépendances** : `js/planning.js`, `FLUX_PIECES_NEUVES_PLANNING.md`.
* **Test existant** : `tests/audit.test.mjs`

---

## 5. Module Espace Technicien

### Fonction : Démarrage / Fin / Pause des Tâches Atelier
* **Description** : Tablette d'atelier permettant au compagnon d'enregistrer ses temps de présence et d'intervention réels.
* **Fichier source** : `js/ui-cases.js` (sections techniciens), `app.js` (tâches techniciens)
* **Boutons/Champs** : Boutons "Démarrer", "Suspendre / Pause", "Finaliser".
* **Données utilisées** : Statuts de réservation (`planned`, `started`, `paused`, `completed`), temps écoulés.
* **Rôle concerné** : Technicien.
* **Importance terrain** : **P1** — Suivi de la productivité.
* **Dépendances** : `TECHNICIAN_FLOW.md`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Suspension avec Motif Normalisé & Création de Reliquat
* **Description** : Mise en pause d'une tâche avec motif obligatoire (ex: attente pièces, attente expert), avec calcul du reliquat de temps à replanifier automatiquement.
* **Fichier source** : `js/ui-cases.js`, `js/planning.js`
* **Boutons/Champs** : Modale de pause, sélection du motif.
* **Données utilisées** : `booking.pauseReason`, création d'une nouvelle réservation `temporary` / `planned` pour le reliquat.
* **Rôle concerné** : Technicien, Chef d'Atelier.
* **Importance terrain** : **P1** — Traçabilité des arrêts.
* **Dépendances** : `TECHNICIAN_FLOW.md`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

---

## 6. Module Contrôle Qualité & Livraison

### Fonction : Checklist de Contrôle Qualité Dynamique
* **Description** : Génération d'une checklist de validation personnalisée selon le type d'intervention déclaré (Mécanique, Peinture, Tôlerie).
* **Fichier source** : `js/exports.js` (`getQualityChecklistForCase`), `js/ui-cases.js`
* **Boutons/Champs** : Liste à puces de checkboxes dans l'onglet qualité.
* **Données utilisées** : `caseItem.qualityChecklist`.
* **Rôle concerné** : Contrôleur Qualité.
* **Importance terrain** : **P1** — Rigueur de conformité.
* **Dépendances** : `js/exports.js`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Retour Atelier / Rework après Rejet QC
* **Description** : Refus de conformité avec saisie obligatoire d'un motif de rejet et redirection automatique vers l'atelier (`qualityRework`).
* **Fichier source** : `js/ui-reception.js` (`renderStep10_QualityCheck`), `js/state.js`
* **Boutons/Champs** : Bouton "Rejeter QC", zone de saisie du motif.
* **Données utilisées** : `caseItem.receptionWorkflow.qualityStatus = "rejected"`, logs de rejet.
* **Rôle concerné** : Contrôleur Qualité.
* **Importance terrain** : **P0** — Garantit qu'un véhicule défectueux ne sort pas.
* **Dépendances** : `js/state.js`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

### Fonction : Validation et Blocage de Livraison Stricte
* **Description** : Verrous de livraison interdisant la restitution si : QC non approuvé, réclamations client non résolues (sauf override autorisé), ou absence de photo "Après réparation" pour les dossiers assurance.
* **Fichier source** : `js/ui-reception.js` (`verifyDeliveryClaimsBlock`), `js/ui-cases.js`
* **Boutons/Champs** : Validation finale de livraison, modale d'override pour forcer avec motif.
* **Données utilisées** : `caseItem.flags.qualityApproved`, présence de photo `after`.
* **Rôle concerné** : Agent de livraison.
* **Importance terrain** : **P0** — Évite les litiges juridiques et assure le paiement assurance.
* **Dépendances** : `js/photos.js`, `js/ui-reception.js`.
* **Test existant** : `tests/reception_qc_field_usability_v2326.test.mjs`

---

## 7. Module Impressions & Exports

### Fonction : Export ZIP Global du Dossier Structuré
* **Description** : Compilation en un seul clic d'une archive ZIP complète contenant le JSON brut, les documents PDF générés par jalon et toutes les photos triées par catégorie.
* **Fichier source** : `js/exports.js` (`exportCaseFolderZip`)
* **Boutons/Champs** : Bouton "Exporter le dossier complet (ZIP)".
* **Données utilisées** : `caseItem`, blobs de photos stockés localement.
* **Rôle concerné** : Chef d'Atelier, Directeur, Réceptionnaire.
* **Importance terrain** : **P0** — Requis pour la facturation et les audits compagnies d'assurance.
* **Dépendances** : `js/exports.js` (bibliothèque ZIP client).
* **Test existant** : Aucun (validation manuelle).

### Fonction : Impression des Fiches Techniques et Documents Métier (PDF)
* **Description** : Génération de documents PDF imprimables (Fiche de travail compagnon, planning Gantt journalier, bon de restitution client, fiche de pause/blocage).
* **Fichier source** : `js/exports.js` (`printRepairOrder`, `printDailyPlanningGantt`, `printTechnicianTaskSheet`, `printPauseBlockSheet`)
* **Boutons/Champs** : Bouton "Imprimer Fiche", "Imprimer Planning".
* **Données utilisées** : Données de planning, dossier véhicule.
* **Rôle concerné** : Technicien, Chef d'Atelier, Agent de livraison.
* **Importance terrain** : **P0** — Continuité papier essentielle dans l'atelier (zones sans tablette/réseau).
* **Dépendances** : `js/exports.js`.
* **Test existant** : Aucun (vérification visuelle).

---

## 8. Module Offline / Synchro / Sécurité

### Fonction : Support Offline PWA (Service Worker)
* **Description** : Mise en cache locale complète des scripts, styles et de l'interface pour permettre l'utilisation continue de l'application sans réseau en fond d'atelier.
* **Fichier source** : `sw.js` (Service Worker racine)
* **Boutons/Champs** : Indicateur de connexion (Online / Offline).
* **Données utilisées** : Cache API.
* **Rôle concerné** : Tous.
* **Importance terrain** : **P0** — L'atelier comporte des zones blanches réseau.
* **Dépendances** : `manifest.webmanifest`.
* **Test existant** : `tests/security_data_hotfix_v2315.test.mjs`

### Fonction : Synchronisation Supabase en Temps Réel
* **Description** : Synchronisation bidirectionnelle automatique des dossiers et plannings avec détection et interface visuelle de résolution de conflits.
* **Fichier source** : `js/supabase-sync.js`, `js/supabase-client.js`
* **Boutons/Champs** : Indicateurs de synchronisation, dialogue de conflit de fusion.
* **Données utilisées** : `syncRevision`, `localRevision`.
* **Rôle concerné** : Tous.
* **Importance terrain** : **P0** — Nécessaire pour le travail collaboratif temps réel.
* **Dépendances** : `supabase-schema.sql`.
* **Test existant** : `tests/security_data_hotfix_v2315.test.mjs`

### Fonction : Verrou de Sécurité Local par Code PIN
* **Description** : Protection de l'interface utilisateur sur tablette partagée par un code PIN temporaire sans chiffrement des données de localStorage.
* **Fichier source** : `app.js` (`bindLocalSecurityControls`, `initLocalSecurityGate`), `js/storage.js`
* **Boutons/Champs** : Écran d'authentification PIN.
* **Données utilisées** : Hash de session.
* **Rôle concerné** : Tous.
* **Importance terrain** : **P1** — Évite l'usurpation de signature.
* **Dépendances** : `BACKLOG_V23.md`.
* **Test existant** : `tests/security_data_hotfix_v2315.test.mjs`
