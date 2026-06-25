# NIMR SAV React — v24.0.0-alpha.10

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

## Structure

```
src/
├── constants/version.ts    ← APP_VERSION, LS_PREFIX, cache name
├── types/index.ts          ← Types: Role, User, Vehicle, QC, Sync
├── hooks/useLocalStorage.ts← Hook localStorage avec préfixe forcé
├── components/ui/          ← Composants réutilisables
├── features/               ← Vues par rôle
│   ├── auth/LoginScreen.tsx
│   ├── reception/
│   ├── technician/
│   ├── qc/
│   ├── chef-atelier/
│   ├── directeur/
│   ├── admin/
│   └── lecture-seule/
└── styles/index.css        ← Design system NIMR v24
tests/
└── foundation.test.ts      ← Tests fondation
```

## Version

`v24.0.0-alpha.10` — Stabilisation globale / Release Candidate readiness interne.
- Cette version n'est pas une Release Candidate (RC) et n'est pas prête pour la production.
- Aucun tag de version v24 ou push ne doit être créé sur cette version.
- Le pilote stable actuel reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement vide (`[]`).
- L'application React fonctionne sans Service Worker actif, sans dépendances backend, et sans Supabase.
