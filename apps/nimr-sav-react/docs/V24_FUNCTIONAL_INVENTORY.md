# Inventaire Fonctionnel Complet — NIMR SAV React v24.0.0-alpha.14

Ce document recense les fonctionnalités implémentées dans la nouvelle version React de l'application (`apps/nimr-sav-react`).

---

## 1. Module Authentification & Gestion de Session

### Fonction : Écran de Connexion Multi-comptes
* **Description** : Authentification simple permettant de sélectionner un rôle de démo et de simuler une connexion utilisateur.
* **Fichier source** : `apps/nimr-sav-react/src/features/auth/LoginScreen.tsx`
* **Composant/Module** : `LoginScreen`
* **Rôle concerné** : Tous.
* **Statut workflow** : Hors workflow (Pré-authentification).
* **Données utilisées** : Constante `DEMO_USERS` dans `apps/nimr-sav-react/src/constants/demo-users.ts`.
* **Couverture test** : `tests/foundation.test.ts`
* **Limites connues** : Simulation pure sans mot de passe réel ni connexion serveur (pas de LDAP/Supabase).

---

## 2. Module Réception (React)

### Fonction : Création de Dossiers (Données Fictives uniquement)
* **Description** : Permet de créer un dossier au statut `draft` ou directement `received` à condition que toutes les entrées respectent les règles de données fictives.
* **Fichier source** : `apps/nimr-sav-react/src/features/reception/ReceptionView.tsx`
* **Composant/Module** : `ReceptionView`
* **Rôle concerné** : Réceptionnaire, Admin.
* **Statut workflow** : Création au statut `draft` ou transition directe vers `received`.
* **Données utilisées** : Immatriculation, VIN, Nom client, Téléphone, Kilométrage, Modèle, Motif (presets).
* **Couverture test** : `tests/reception-integration.test.ts`
* **Limites connues** : **Bloquant terrain** — Interdit l'utilisation opérationnelle réelle en rejetant toute donnée ne commençant pas par `DEMO-` ou `Client Démo`.

### Fonction : Qualification simplifiée du Véhicule
* **Description** : Permet de renseigner le motif de prise en charge et le type d'intervention primaire.
* **Fichier source** : `apps/nimr-sav-react/src/features/reception/ReceptionView.tsx`
* **Composant/Module** : `ReceptionView`
* **Rôle concerné** : Réceptionnaire, Admin.
* **Statut workflow** : `draft`
* **Données utilisées** : `caseObj.status`, `caseObj.receptionDate`.
* **Couverture test** : `tests/reception-integration.test.ts`
* **Limites connues** : Aucun import de devis. Saisie uniquement déclarative.

---

## 3. Module Planning Atelier Simplifié

### Fonction : Affectation de Technicien, Baie et Plages Horaires
* **Description** : Affecte manuellement une ressource technique, une baie physique et des dates de début/fin à un dossier.
* **Fichier source** : `apps/nimr-sav-react/src/features/chef-atelier/PlanningView.tsx`
* **Composant/Module** : `PlanningView`
* **Rôle concerné** : Chef d'Atelier, Admin.
* **Statut workflow** : `received` ou `diagnosis` ou `repair`.
* **Données utilisées** : `caseObj.assignedTechnicianId`, `caseObj.workshopBay`, `caseObj.plannedStartAt`, `caseObj.plannedEndAt`, `caseObj.estimatedDurationMinutes`.
* **Couverture test** : `tests/chef-atelier-integration.test.ts`
* **Limites connues** : Pas de Gantt interactif. Pas de détection de collision ou chevauchement d'horaires. Pas de calcul de capacité.

### Fonction : Gestion des Tâches Plates (Workshop Tasks)
* **Description** : Ajout d'une liste de sous-tâches textuelles affectées au véhicule que le technicien devra cocher.
* **Fichier source** : `apps/nimr-sav-react/src/features/chef-atelier/PlanningView.tsx`
* **Composant/Module** : `PlanningView`
* **Rôle concerné** : Chef d'Atelier, Admin.
* **Statut workflow** : `received`
* **Données utilisées** : `caseObj.workshopTasks` (array de `WorkshopTask`).
* **Couverture test** : `tests/chef-atelier-integration.test.ts`
* **Limites connues** : Tâches plates sans jalons complexes ni ordonnancement en parallèle (pas d'anticipation de pièces neuves).

---

## 4. Module Espace Technicien (React)

### Fonction : Tableau de Bord d'Atelier Personnel
* **Description** : Permet au technicien connecté d'afficher sa file d'attente de véhicules affectés.
* **Fichier source** : `apps/nimr-sav-react/src/features/technician/TechnicianView.tsx`
* **Composant/Module** : `TechnicianView`
* **Rôle concerné** : Technicien.
* **Statut workflow** : `diagnosis` | `waiting_parts` | `repair` | `work_completed`.
* **Données utilisées** : `savCaseStore.getCasesForTechnician(technicianId)`.
* **Couverture test** : `tests/technician-integration.test.ts`
* **Limites connues** : Vue limitée aux dossiers dont le technicien est l'affecté principal.

### Fonction : Démarrage et Validation des Tâches
* **Description** : Permet au technicien de déclarer le démarrage des travaux (transition vers `repair`), de passer les tâches en cours à `done` et de finaliser (transition vers `work_completed` exigeant que toutes les tâches soient cochées).
* **Fichier source** : `apps/nimr-sav-react/src/features/technician/TechnicianView.tsx`
* **Composant/Module** : `TechnicianView`
* **Rôle concerné** : Technicien.
* **Statut workflow** : Démarrage (`repair`), Finalisation (`work_completed`).
* **Données utilisées** : `savCaseStore.updateWorkshopTaskStatus`, `savCaseStore.completeTechnicianWork`.
* **Couverture test** : `tests/technician-integration.test.ts`
* **Limites connues** : Pas de fonction "Pause" ni de saisie de motif d'arrêt. Pas de gestion de reliquats automatiques. Pas d'ajout de photo.

---

## 5. Module Contrôle Qualité (React)

### Fonction : Évaluation de la Checklist Qualité
* **Description** : Validation de la checklist obligatoire avant restitution.
* **Fichier source** : `apps/nimr-sav-react/src/features/qc/QCView.tsx`
* **Composant/Module** : `QCView`
* **Rôle concerné** : Contrôleur Qualité (rôle `qualite`), Admin.
* **Statut workflow** : `quality_pending` -> `quality_approved` ou `quality_rejected`.
* **Données utilisées** : `caseObj.qcChecklist` (chargée depuis la constante fixe `DEMO_QC_CHECKLIST`).
* **Couverture test** : `tests/qc-integration.test.ts`
* **Limites connues** : Checklist non dynamique (identique pour tous les véhicules, qu'ils soient en mécanique ou carrosserie).

### Fonction : Reprise Atelier (Rework)
* **Description** : Transition vers `quality_rework` avec saisie obligatoire d'un motif de rejet pour renvoyer le véhicule au technicien.
* **Fichier source** : `apps/nimr-sav-react/src/features/qc/QCView.tsx`
* **Composant/Module** : `QCView`
* **Rôle concerné** : Contrôleur Qualité, Chef d'Atelier.
* **Statut workflow** : `quality_rejected` -> `quality_rework` -> `quality_pending`.
* **Données utilisées** : `caseObj.qcRejectionReason`, `caseObj.qcReworkReason`.
* **Couverture test** : `tests/qc-integration.test.ts`
* **Limites connues** : Le motif est stocké comme une simple chaîne plate sur l'objet véhicule principal sans historique cumulé des rejets.

---

## 6. Module Livraison (React)

### Fonction : Validation de la Preuve de Restitution
* **Description** : Saisie obligatoire du nom du destinataire et d'une référence de preuve pour valider la livraison.
* **Fichier source** : `apps/nimr-sav-react/src/features/delivery/DeliveryView.tsx`
* **Composant/Module** : `DeliveryView`
* **Rôle concerné** : Agent de livraison (rôle `livraison`), Admin.
* **Statut workflow** : `ready_delivery` -> `delivered`.
* **Données utilisées** : `caseObj.deliveryRecipientName`, `caseObj.deliveryProofReference`, `caseObj.deliveryNotes`.
* **Couverture test** : `tests/delivery-integration.test.ts`
* **Limites connues** : Pas de contrôle de présence de photos "Après réparation". Aucun document de bon de livraison généré ni imprimable.

---

## 7. Module Direction SAV & Consultation

### Fonction : Cockpit et KPIs de Performance
* **Description** : Tableau de bord affichant le volume de dossiers, la file d'attente par service, la charge par technicien et le score de santé opérationnelle.
* **Fichier source** : `apps/nimr-sav-react/src/features/directeur/DashboardView.tsx`
* **Composant/Module** : `DashboardView`
* **Rôle concerné** : Directeur SAV, Admin.
* **Statut workflow** : Consultation passive uniquement (interdiction stricte de modifier l'état ou les affectations).
* **Données utilisées** : `director-kpis.ts` (`calculateDirectorDashboard`).
* **Couverture test** : `tests/director-dashboard-integration.test.ts`
* **Limites connues** : Pas de filtres avancés par période. Pas d'exports de rapports Excel ou PDF hebdomadaires/mensuels. Pas de bouton d'override de livraison.

---

## 8. Module Administration & Gouvernance (React)

### Fonction : Actions Exceptionnelles Administrateur
* **Description** : Permet à l'administrateur technique d'outrepasser les règles du workflow (ex: annuler un dossier après démarrage, forcer un retour depuis l'état clos).
* **Fichier source** : `apps/nimr-sav-react/src/features/admin/AdminView.tsx`
* **Composant/Module** : `AdminView`
* **Rôle concerné** : Administrateur (rôle `admin`).
* **Statut workflow** : Toutes transitions autorisées.
* **Données utilisées** : `savCaseStore.transitionWorkshopCase` avec indicateur `isExceptionalAdminAction`.
* **Couverture test** : `tests/admin-governance-integration.test.ts`
* **Limites connues** : Réservé exclusivement à l'Admin. Ne permet plus de gérer la base de données cloud (Supabase absente).
