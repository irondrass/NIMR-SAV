# NIMR SAV React — v24.0.0-alpha.12

Application React + TypeScript pour NIMR Carrosserie SAV.

> **Alpha** — Fondation uniquement. Ne remplace pas l'application v23.x en production.

## Séparation stricte de v23.x

| Élément | v23.x (racine) | v24 (apps/nimr-sav-react/) |
|---|---|---|
| Port | Serveur statique | 5173 (Vite) |
| localStorage | `nimr-sav-*` | `nimr-sav-react-v24-*` |
| Service Worker | `sw.js` actif | Aucun (réservé) |
| Cache | `nimr-sav-v23.2.x-*` | `nimr-sav-react-v24-alpha` (réservé) |
| Données | `data/vehicles.json` | Aucune donnée réelle |

## Commandes

```bash
# Installer les dépendances
npm install

# Démarrer en développement (port 5173)
npm run dev

# Vérification TypeScript + build
npm run build

# Linter
npm run lint

# Tests
npm test
```

## Écrans par rôle

- **Réception SAV** : Créer et qualifier les dossiers atelier lors de la prise en charge.
- **Planification Atelier** : Chef d'Atelier planifie les dossiers, affecte les techniciens et gère la priorité.
- **Espace Technicien** : Suivi des tâches affectées sur tablette tactile et validation d'avancement.
- **Contrôle Qualité** : Validation technique de conformité avec checklist et gestion des reprises.
- **Livraison Client** : Préparation, preuve de livraison et confirmation finale de la remise.
- **Directeur SAV** : Consultation du tableau de bord KPI et des alertes opérationnelles (lecture seule).
- **Console Administration** : Supervision de la gouvernance et de la conformité technique (lecture seule).
- **Mode Lecture Seule** : Consultation passive globale sans aucune action d'écriture ou modification.

## Version

`v24.0.0-alpha.12` — Recette métier terrain / simulation multi-dossiers.

- Cette version est une alpha interne, non RC et non destinée à la production.
- Aucun tag ni push n'est créé pour cette version.
- Le pilote stable actuel reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement vide (`[]`).
- L'application React fonctionne sans Service Worker actif, sans dépendances backend, et sans Supabase.

## Recette métier alpha.12

La simulation couvre cinq dossiers fictifs en parallèle :

- un flux complet réception → atelier → technicien → contrôle qualité → livraison ;
- un dossier bloqué en `waiting_parts` ;
- un rejet qualité suivi d'une reprise atelier ;
- une tentative de livraison bloquée avant approbation qualité ;
- un dossier annulé selon le workflow existant.

Les consultations Direction SAV, Admin/Gouvernance et Lecture seule sont contrôlées sans mutation des dossiers ni création de logs. Les timelines restent isolées par dossier et traçables par `caseId`, y compris avec des données locales vides ou partielles.

Prochaine étape possible : `alpha.13`, préparation à l'évaluation RC et gel fonctionnel.
