# NIMR SAV React — v24.0.0-alpha.13

Préparation RC / gel fonctionnel / documentation finale.

Application React + TypeScript pour NIMR Carrosserie SAV.

> Alpha interne — cette version n’est pas une RC et n’est pas destinée à la production. Elle prépare une future évaluation, sans publication automatique.

## Séparation stricte de v23.x

| Élément | v23.x (racine) | v24 (apps/nimr-sav-react/) |
|---|---|---|
| Statut | Pilote stable `v23.2.6` | Migration alpha interne |
| Port | Serveur statique | 5173 (Vite) |
| localStorage | `nimr-sav-*` | `nimr-sav-react-v24-*` |
| Service Worker | `sw.js` actif côté v23 | Aucun service worker React actif |
| Cache | `nimr-sav-v23.2.x-*` | `nimr-sav-react-v24-alpha` réservé |
| Données | `data/vehicles.json` | Doit rester strictement `[]` |

## Commandes

```bash
# Installer les dépendances
npm ci

# Démarrer en développement (port 5173)
npm run dev

# Vérification TypeScript + build
npm run build

# Linter
npm run lint

# Tests
npm test

# Audit dépendances
npm audit --registry=https://registry.npmjs.org/
```

## Écrans par rôle

- Réception SAV : créer et qualifier les dossiers atelier lors de la prise en charge.
- Planification Atelier : affecter les techniciens, gérer la priorité et organiser les tâches.
- Espace Technicien : suivre les tâches affectées et valider l’avancement atelier.
- Contrôle Qualité : vérifier la conformité technique et gérer les reprises.
- Livraison Client : préparer la remise, ajouter une preuve et confirmer la livraison.
- Directeur SAV : consulter les KPIs et alertes opérationnelles sans mutation métier.
- Console Administration : consulter la gouvernance, les rôles et les invariants.
- Mode Lecture Seule : consulter passivement sans action d’écriture.

## Version

`v24.0.0-alpha.13` — Préparation RC / gel fonctionnel / documentation finale.

- Alpha interne uniquement.
- Non RC.
- Non destinée à la production.
- Aucun push ni tag automatique pour cette étape.
- Le pilote stable reste exclusivement `v23.2.6`.
- Le fichier `data/vehicles.json` reste strictement `[]`.
- React v24 reste sans service worker actif.
- Aucun backend ajouté.
- Aucun Supabase ajouté.
- La recette métier alpha.12 est conservée.

## Gel fonctionnel alpha.13

alpha.13 ajoute :

- un module de readiness de gel fonctionnel ;
- une checklist de préparation à une future évaluation RC ;
- des critères GO / NO-GO explicites ;
- des preuves automatiques de non-régression métier ;
- une documentation finale avant arbitrage humain.

Les validations conceptuelles couvrent :

- version alignée sur `v24.0.0-alpha.13` ;
- application encore alpha, non RC et non destinée à la production ;
- absence de tag attendu ;
- `v23.2.6` conservée comme version stable / pilote ;
- données publiques véhicules vides ;
- absence de backend, Supabase et service worker React actif ;
- rôles et statuts officiels uniquement ;
- flux métier alpha.12 conservé ;
- consultation Direction/Admin/Lecture seule sans mutation ;
- livraison impossible sans qualité approuvée ;
- dossier livré sans retour arrière.

## Recette métier conservée

La simulation alpha.12 reste le socle métier de validation avec cinq dossiers fictifs en parallèle :

- un flux complet réception → atelier → technicien → contrôle qualité → livraison ;
- un dossier bloqué en `waiting_parts` ;
- un rejet qualité suivi d’une reprise atelier ;
- une tentative de livraison bloquée avant approbation qualité ;
- un dossier annulé selon le workflow existant.

Les consultations Direction SAV, Admin/Gouvernance et Lecture seule restent passives : elles ne modifient pas les dossiers et ne créent pas de logs de workflow.

## Prochaine étape possible

Décision humaine GO / NO-GO pour une éventuelle `v24.0.0-rc.1`, après clone frais, validations automatisées, smoke navigateur, tests v23.2.6 et validation manuelle terrain.
