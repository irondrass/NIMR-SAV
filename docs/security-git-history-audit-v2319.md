# v23.1.9 - Git history PII audit and repository exposure report

Date: 2026-06-06

Reference HEAD audite: `6c06a67 Release v23.1.8 roles and governance hardening`

## Synthese

Des donnees sensibles historiques ont ete trouvees dans l'historique Git.

Le fichier courant `data/vehicles.json` reste vide (`[]`), mais un ancien blob Git rattache au commit initial `e1962f3 Add files via upload` contient des donnees clients et vehicules reelles. Ces donnees restent accessibles a toute personne disposant d'un clone complet, d'un tag, d'une branche locale ou d'une branche distante contenant ce commit.

Niveau de risque: **eleve** si le depot est public, a ete public, ou a ete partage hors d'un cercle strictement controle. Niveau de risque: **moyen a eleve** si le depot est prive mais accessible a de nombreux comptes, forks, archives ou clones.

## Perimetre audite

- Branche courante: `main`
- HEAD: `6c06a67`
- Tags connus: `v23.0`, `v23.0.1`, `v23.0.4`, `v23.0.6`, `v23.1.0`, `v23.1.1`, `v23.1.2`, `v23.1.5`, `v23.1.6`, `v23.1.7`, `v23.1.8`
- Branches locales et branches de suivi distantes accessibles dans le clone local
- Historique du fichier `data/vehicles.json`
- Inventaire des objets Git correspondant a des chemins data, backup, export et fichiers `.json`, `.csv`, `.xls`, `.xlsx`, `.nimrsecure`
- Controle du fichier courant `data/vehicles.json`
- Controle que `data/vehicles.json` n'est pas reference comme ressource pre-cachee dans `sw.js`

Limitation: un scan regex global automatise sur tous les commits a ete bloque par l'environnement d'execution. L'audit s'appuie donc sur l'analyse ciblee du fichier sensible identifie, l'inventaire des objets et chemins historiques, les branches/tags accessibles et les controles du HEAD courant. Cette limitation ne change pas le niveau de risque, car le blob historique sensible a ete directement identifie et analyse.

## Donnees sensibles trouvees

### `data/vehicles.json` dans l'historique Git

Commit concerne:

- `e1962f3af1f7280cfce9be5e9ed0be9efe9a15fb` - `Add files via upload`

Blob concerne:

- `a113e83820d995ad0f79735f3daa11e3fd9e7c03`
- Taille: environ 1,66 Mo

Analyse agregree du contenu historique, sans reproduction de valeur sensible:

- Enregistrements vehicules: 7 492
- Noms clients renseignes: 7 283
- Numeros de telephone renseignes: 6 893
- VIN renseignes: 7 492
- Immatriculations renseignees: 6 850
- Donnees vehicule renseignees: 7 317
- Emails renseignes dans ce fichier: 0
- Occurrences detectees par motifs:
  - VIN: 7 108
  - Immatriculations: 6 086
  - Telephones: 7 405
  - Emails: 0

Types de donnees exposees:

- VIN
- Immatriculations
- Numeros de telephone
- Noms clients
- Donnees vehicules reelles

### Etat courant du fichier sensible

Commit de correction:

- `9512256b6f51b4705487a8d379e1f509497a6203` - `Release v23.1.5 security hotfix remove public vehicle PII`

Blob courant vide:

- `fe51488c7066f6687ef680d6bfaa4f7768ef205c`

Resultat courant:

- `data/vehicles.json` contient `[]`
- Aucun enregistrement courant
- Aucune occurrence courante VIN, immatriculation, telephone ou email dans ce fichier

## Fichiers concernes

| Fichier | Etat | Risque |
| --- | --- | --- |
| `data/vehicles.json` | Donnees reelles presentes dans l'historique, supprimees du HEAD courant | Eleve |
| `js/exports.js` | Identifie par l'inventaire des chemins export, mais correspond a du code applicatif | Faible |

Aucun fichier historique `.csv`, `.xls`, `.xlsx` ou `.nimrsecure` contenant des donnees clients n'a ete identifie par l'inventaire des chemins et objets Git realise dans ce clone.

## Commits et accessibilite

Historique du fichier `data/vehicles.json`:

- `e1962f3 Add files via upload` a introduit le fichier contenant les donnees sensibles.
- `9512256 Release v23.1.5 security hotfix remove public vehicle PII` a remplace le contenu public par `[]`.

Accessibilite:

- Le commit `e1962f3` est contenu dans `main`.
- Le commit est aussi contenu par les branches locales et les branches de suivi distantes derivees de `main` presentes dans ce clone.
- Les tags anterieurs a la correction v23.1.5 peuvent conserver un chemin simple vers le blob historique.
- Les clones, forks, archives telechargees et caches externes qui precedent la correction peuvent conserver une copie du blob sensible.

## Verification des garde-fous

- Aucune suppression d'historique n'a ete effectuee.
- Aucun force-push n'a ete effectue.
- Aucun tag n'a ete cree, modifie ou supprime.
- Aucun fichier runtime n'a ete modifie par cet audit.
- `data/vehicles.json` reste vide dans le HEAD courant.
- `data/vehicles.json` n'est pas pre-cache dans `sw.js`.
- v23.2.0 et v23.1D n'ont pas ete commencees.

## Niveau de risque

Risque global: **eleve**.

Motifs:

- Les donnees clients et vehicules reelles restent presentes dans l'historique Git.
- La correction v23.1.5 protege le HEAD courant mais ne purge pas les anciens blobs.
- Si le depot etait public ou partage, les donnees doivent etre considerees comme potentiellement copiees hors du depot actuel.
- Les tags, branches, forks, archives et clones existants peuvent rendre le blob encore accessible.

## Recommandations

### a) Conserver tel quel si aucune donnee reelle

Non recommande dans l'etat constate, car des donnees reelles ont ete trouvees dans l'historique.

Cette option ne serait acceptable que si les responsables metier, securite et conformite confirment que les donnees ne sont pas reelles ou que le risque residuel est formellement accepte dans un depot strictement prive et controle.

### b) Passer le depot en prive si donnees reelles

Recommande immediatement si le depot est public ou a une visibilite large.

Actions conseillees:

- Passer le depot en prive.
- Limiter les acces aux seuls comptes necessaires.
- Verifier les forks et miroirs.
- Verifier les archives de releases et telechargements publics.
- Considerer les clones deja diffuses comme compromis.

### c) Purge historique controlee si donnees reelles

Recommande si le depot doit rester partage, si l'exposition publique a existe, ou si une exigence RGPD/conformite impose la suppression de l'historique.

Procedure conseillee, uniquement apres validation explicite:

- Geler temporairement les pushes.
- Sauvegarder le depot avant traitement.
- Utiliser un outil adapte comme `git filter-repo` ou BFG pour retirer le blob historique `data/vehicles.json` de toutes les references.
- Revalider les branches, tags et archives de release apres reecriture.
- Force-push uniquement apres accord public et coordination avec tous les contributeurs.
- Demander a tous les contributeurs de recloner le depot.
- Nettoyer ou supprimer les forks, miroirs et caches lorsque c'est possible.

Aucune de ces actions destructives n'a ete realisee pendant cet audit.

### d) Rotation cles/config si necessaire

Aucune cle active reelle n'a ete confirmee dans le HEAD courant pendant cet audit; les references visibles sont principalement des placeholders, de la configuration locale ou des tests de non-regression.

Rotation recommandee si l'une des conditions suivantes est vraie:

- Une URL Supabase reelle, une cle anon, une cle service role, un token ou une configuration sensible a ete commitee dans un ancien commit.
- Ces identifiants ont ete utilises avec les donnees exposees.
- Le depot etait public ou a ete clone par des tiers non autorises.

La rotation devrait couvrir au minimum les cles Supabase, tokens d'API, secrets d'environnement, identifiants de synchronisation et sessions administratives associees.

## Conclusion

Le depot est propre au niveau du HEAD courant pour `data/vehicles.json`, mais l'historique Git contient toujours un ancien fichier client/vehicule sensible. La mesure minimale recommandee est de rendre ou maintenir le depot prive et de restreindre les acces. Si le depot a ete public ou si une suppression effective est requise, une purge historique controlee doit etre planifiee separement, avec validation explicite, coordination contributeurs et rotation des secrets pertinents.
