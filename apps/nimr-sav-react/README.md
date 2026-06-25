# NIMR SAV React — v24.0.0-alpha.11

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

`v24.0.0-alpha.11` — Pré-RC UX terrain / cohérence finale des écrans.
- Cette version n'est pas une Release Candidate (RC) et n'est pas prête pour la production.
- Aucun tag de version v24 ou push ne doit être créé sur cette version.
- Le pilote stable actuel reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement vide (`[]`).
- L'application React fonctionne sans Service Worker actif, sans dépendances backend, et sans Supabase.
