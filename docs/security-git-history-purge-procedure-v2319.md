# v23.1.9 - Procedure de purge historique controlee

Date: 2026-06-06

Incident de reference: ancien `data/vehicles.json` contenant des donnees clients et vehicules reelles, introduit par `e1962f3 Add files via upload`.

HEAD sain avant procedure: `2dd1ccf docs: add v23.1.9 git history PII audit report`

Etat courant attendu: `data/vehicles.json` contient uniquement `[]`.

## Statut de ce document

Ce document prepare une purge historique controlee. Il ne declenche aucune purge par lui-meme.

Ne pas executer les commandes destructives sans validation explicite de la direction, de l'IT et du referent juridique/conformite selon la procedure interne.

Interdits avant validation:

- Pas de force-push.
- Pas de creation de tag v23.1.9.
- Pas de push du commit `2dd1ccf` tant que le depot est public.
- Pas de reecriture de tags sans accord.
- Pas de suppression de branches distantes sans accord.

## Objectifs

- Retirer `data/vehicles.json` de tout l'historique Git.
- Restaurer ensuite un `data/vehicles.json` propre contenant `[]`.
- Revalider que les anciennes donnees ne sont plus presentes dans `git log`, les objets Git et les recherches historiques.
- Publier l'historique purge uniquement apres mise en prive du depot et validation publique.
- Documenter les limites: clones, forks, archives et caches externes peuvent encore conserver les anciennes donnees.

## Roles et validation

Avant execution, identifier et faire valider:

- Responsable metier.
- IT / administrateur GitHub.
- Direction.
- Juridique / DPO / referent conformite.
- Personne chargee d'executer la purge.
- Personne chargee de verifier le depot purge dans un clone frais.

Informer les parties prenantes que la purge implique une reecriture d'historique: tous les contributeurs devront recloner ou resynchroniser proprement leur depot local.

## Pre-conditions obligatoires

1. Mettre le depot GitHub en prive avant tout push.
2. Geler temporairement les merges et pushes.
3. Bloquer ou suspendre les workflows qui publient des artefacts publics.
4. Verifier les forks, miroirs, releases, archives et caches accessibles.
5. Confirmer que les derniers commits locaux non pousses ne doivent pas etre publies tant que le depot est public.
6. Travailler dans un clone dedie a la purge, separe du poste de developpement habituel.

## Sauvegarde locale avant purge

Executer dans le clone source, avant toute reecriture:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2\__github_publish_NIMR_SAV"
git status
git fetch --all --tags --prune
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
git bundle create "..\nimr-sav-before-history-purge-$stamp.bundle" --all --tags
git bundle verify "..\nimr-sav-before-history-purge-$stamp.bundle"
```

Option de controle recommande:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2"
git clone "nimr-sav-before-history-purge-$stamp.bundle" "__verify_bundle_before_purge"
cd "__verify_bundle_before_purge"
git status
git log --oneline --decorate --all --max-count=10
```

Conserver le bundle hors du depot Git, avec acces limite. Ce bundle contient l'historique sensible et doit etre traite comme un support confidentiel.

## Installation et verification de git-filter-repo

Verifier d'abord si l'outil est disponible:

```powershell
git filter-repo --help
```

Si la commande n'existe pas, installation possible avec Python:

```powershell
python -m pip install --user git-filter-repo
git filter-repo --help
```

Alternative avec `pipx` si disponible:

```powershell
pipx install git-filter-repo
git filter-repo --help
```

Verifier la version:

```powershell
git filter-repo --version
```

## Preparation du clone de purge

Utiliser un clone dedie:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2"
git clone --mirror "__github_publish_NIMR_SAV" "__nimr_sav_purge_mirror.git"
cd "__nimr_sav_purge_mirror.git"
git show-ref
```

Un clone miroir permet de traiter branches et tags ensemble. Ne pas travailler dans le clone de developpement principal.

## Suppression de data/vehicles.json de tout l'historique

Dans le clone miroir dedie, retirer le fichier sensible de toutes les references:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2\__nimr_sav_purge_mirror.git"
git filter-repo --path data/vehicles.json --invert-paths --force
```

Effet attendu:

- `data/vehicles.json` est supprime de tous les anciens commits.
- Les commits et tags concernes sont reecrits.
- Les signatures de tags signes peuvent etre invalidees.
- Le remote `origin` peut etre retire par securite par `git-filter-repo`; il devra etre reconfigure explicitement apres validation.

## Restauration propre de data/vehicles.json avec []

Apres la purge, creer un clone de travail depuis le miroir purge:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2"
git clone "__nimr_sav_purge_mirror.git" "__nimr_sav_after_purge_work"
cd "__nimr_sav_after_purge_work"
```

Recreer le fichier propre:

```powershell
New-Item -ItemType Directory -Force data
Set-Content -Path "data\vehicles.json" -Value "[]" -NoNewline
git add data\vehicles.json
git commit -m "security: restore empty public vehicles dataset after history purge"
```

Verifier que le contenu courant est strictement vide:

```powershell
Get-Content data\vehicles.json
git status --short
```

Resultat attendu pour le contenu:

```json
[]
```

## Verification apres purge

Verifier que l'historique du fichier ne pointe plus vers l'ancien contenu:

```powershell
git log --all --full-history --oneline -- data/vehicles.json
```

Resultat attendu:

- Aucun commit ancien contenant le fichier sensible.
- Eventuellement uniquement le commit de restauration propre avec `[]`.

Verifier les objets Git references:

```powershell
git rev-list --objects --all | rg -i "data/vehicles\.json|vehicles|\.csv|\.xlsx|\.xls|\.nimrsecure|backup|export"
```

Resultat attendu:

- `data/vehicles.json` ne doit apparaitre que comme fichier propre recent, si present.
- Aucun objet historique correspondant au blob sensible `a113e83820d995ad0f79735f3daa11e3fd9e7c03`.

Verifier l'absence de motifs PII dans l'historique purge:

```powershell
git grep -I -n -E "[A-HJ-NPR-Z0-9]{17}" $(git rev-list --all)
git grep -I -n -E "[0-9]{1,4}[ -]?[A-Z]{1,3}[ -]?[0-9]{1,4}" $(git rev-list --all)
git grep -I -n -E "(\+216|00216|216)?[ -]?[24579][0-9]{7}" $(git rev-list --all)
git grep -I -n -E "[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}" $(git rev-list --all)
```

Notes de verification:

- Ces recherches peuvent produire des faux positifs dans le code, les tests ou la documentation.
- Tout resultat doit etre examine sans recopier de valeur sensible dans un ticket public.
- Si `git grep` renvoie encore l'ancien `data/vehicles.json` ou des donnees clients reelles, la purge est incomplete.

Verifier les refs et tags:

```powershell
git show-ref
git tag --list
git branch --all
```

Verifier le contenu courant:

```powershell
git show HEAD:data/vehicles.json
```

Resultat attendu:

```json
[]
```

## Traitement des tags existants

Les tags qui pointaient vers l'ancien historique doivent etre traites explicitement.

Options possibles, a valider avant execution:

1. Reecrire les tags avec `git-filter-repo`, puis force-pusher les tags reecrits apres validation.
2. Supprimer les tags historiques exposes, puis recreer uniquement les tags approuves sur l'historique purge.
3. Conserver localement une archive confidentielle des anciens tags dans le bundle, mais ne plus les publier.

Verification des tags avant purge:

```powershell
git tag --contains e1962f3
git tag --list
git show-ref --tags
```

Verification des tags apres purge:

```powershell
git tag --list
git show-ref --tags
git cat-file -e e1962f3^{commit}
```

Resultat attendu:

- Aucun tag public ne doit permettre d'atteindre l'ancien commit `e1962f3`.
- Aucun tag public ne doit permettre d'atteindre le blob sensible historique.
- `git cat-file -e e1962f3^{commit}` doit echouer dans le depot purge si l'ancien commit n'est plus present.

Si des tags distants doivent etre supprimes, le faire uniquement apres accord explicite:

```powershell
git push origin --delete <tag>
```

Si des tags reecrits doivent etre publies, le faire uniquement apres validation:

```powershell
git push origin --force --tags
```

## Traitement des branches distantes anciennes

Lister les branches qui contiennent l'ancien commit dans le depot avant purge:

```powershell
git branch --all --contains e1962f3
```

Apres purge, aucune branche publiee ne doit permettre d'atteindre `e1962f3`.

Options possibles:

1. Reecrire et force-pusher les branches conservees.
2. Supprimer les branches distantes obsoletes qui ne doivent plus exister.
3. Recloner les branches utiles depuis l'historique purge.

Suppression d'une branche distante obsolete, uniquement apres validation:

```powershell
git push origin --delete <branch-name>
```

Publication d'une branche reecrite, uniquement apres mise en prive et validation:

```powershell
git push origin --force-with-lease <local-branch>:<remote-branch>
```

Pour un miroir complet, publication controlee possible uniquement apres accord:

```powershell
git remote add origin <PRIVATE_REPOSITORY_URL>
git push --mirror origin
```

Attention: `git push --mirror` remplace les references distantes par celles du miroir local. Cette commande est tres sensible et doit etre executee seulement par l'administrateur GitHub designe.

## Force-push uniquement apres mise en prive

Avant tout force-push:

- Confirmer que le depot GitHub est prive.
- Confirmer que les protections de branche et workflows publics sont adaptes.
- Confirmer que les forks publics sont traites ou supprimes si possible.
- Confirmer que la direction, l'IT et le juridique/conformite ont valide.
- Confirmer qu'un bundle de sauvegarde existe et est stocke de maniere confidentielle.
- Confirmer qu'un clone frais du depot purge passe les verifications.

Commandes de publication a ne lancer qu'apres validation:

```powershell
git remote add origin <PRIVATE_REPOSITORY_URL>
git push --force-with-lease origin main
git push --force --tags origin
```

Si plusieurs branches doivent rester publiees, les publier une par une avec `--force-with-lease` ou utiliser `git push --mirror origin` uniquement si l'administrateur accepte de remplacer toutes les references distantes.

## Validation avant remise publique et validation publique apres purge

Apres publication de l'historique purge dans le depot prive, realiser une validation depuis un clone frais:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2"
git clone <PRIVATE_REPOSITORY_URL> "__nimr_sav_public_validation_after_purge"
cd "__nimr_sav_public_validation_after_purge"
git fetch --all --tags --prune
git status --short
git show HEAD:data/vehicles.json
git log --all --full-history --oneline -- data/vehicles.json
git rev-list --objects --all | rg -i "data/vehicles\.json|vehicles|\.csv|\.xlsx|\.xls|\.nimrsecure|backup|export"
```

Controle attendu:

- `data/vehicles.json` contient `[]`.
- Aucun ancien commit ne contient le fichier sensible.
- Aucun blob sensible historique n'est reference.
- Les tags publics restants ne permettent pas d'atteindre l'ancien historique.
- Les branches distantes obsoletes ont ete supprimees ou reecrites.

Consigner la validation dans un compte-rendu interne, sans recopier de donnees sensibles.

Si le depot doit redevenir public, ne modifier la visibilite qu'apres cette validation interne. Une fois la remise publique approuvee, refaire la meme validation depuis l'URL publique ou depuis une archive telechargee publiquement:

```powershell
cd "C:\Users\mhadh\Desktop\NIMR CARROSSERIE V2"
git clone <PUBLIC_REPOSITORY_URL> "__nimr_sav_public_visibility_validation"
cd "__nimr_sav_public_visibility_validation"
git fetch --all --tags --prune
git show HEAD:data/vehicles.json
git log --all --full-history --oneline -- data/vehicles.json
git rev-list --objects --all | rg -i "data/vehicles\.json|vehicles|\.csv|\.xlsx|\.xls|\.nimrsecure|backup|export"
```

La validation publique doit confirmer qu'aucune reference publique ne permet d'atteindre l'ancien commit `e1962f3` ou le blob sensible historique.

## Clones, caches et limites externes

Une purge Git ne garantit pas l'effacement des copies deja diffusees.

Peuvent encore contenir les anciennes donnees:

- Clones locaux des contributeurs.
- Forks GitHub.
- Archives ZIP/tar telechargees.
- Caches GitHub ou moteurs d'indexation.
- Artefacts CI/CD.
- Backups postes ou serveurs.
- Miroirs externes.

Actions recommandees:

- Demander aux contributeurs de supprimer leurs anciens clones et de recloner le depot purge.
- Supprimer ou rendre prives les forks.
- Supprimer les releases/archive assets exposees si elles contiennent l'ancien historique.
- Ouvrir une demande support GitHub si des caches publics restent accessibles.
- Rechercher et supprimer les copies dans les sauvegardes internes selon la politique de retention.

## Rotation cles et configurations

Si le depot a ete public ou si des cles/configurations reelles ont ete commitees dans l'historique, proceder a une rotation controlee:

- Supabase URL et cles anon/service role.
- Tokens API.
- Secrets d'environnement.
- Identifiants de synchronisation.
- Sessions administratives.
- Webhooks et integrations externes.

La rotation doit etre coordonnee avec l'IT et documentee separement.

## Communication interne recommandee

Informer selon la procedure interne:

- IT / administrateur GitHub.
- Direction.
- Juridique / DPO / conformite.
- Responsable metier SAV.
- Equipe de developpement ayant clone le depot.

Le message doit indiquer:

- La nature de l'incident.
- La periode d'exposition connue.
- Les types de donnees concernes.
- Les actions deja realisees.
- Les actions a venir.
- Les consignes de suppression/reclonage pour les contributeurs.

Ne pas transmettre de valeurs sensibles dans les messages ou tickets.

## Checklist d'execution

- [ ] Depot GitHub rendu prive.
- [ ] Validation direction / IT / juridique obtenue.
- [ ] Freeze temporaire des pushes active.
- [ ] Bundle local cree et verifie.
- [ ] Clone miroir dedie cree.
- [ ] `git-filter-repo` installe et verifie.
- [ ] `data/vehicles.json` purge de tout l'historique.
- [ ] `data/vehicles.json` restaure avec `[]`.
- [ ] Tags reecrits ou supprimes selon decision validee.
- [ ] Branches distantes anciennes reecrites ou supprimees selon decision validee.
- [ ] Clone frais de validation cree.
- [ ] Recherches historiques validees sans ancien blob sensible.
- [ ] Publication force-push effectuee uniquement apres validation.
- [ ] Contributeurs informes de recloner.
- [ ] Caches, forks, releases et artefacts traites.
- [ ] Rotation secrets/config realisee si necessaire.
- [ ] Compte-rendu interne ferme.

## Conclusion

La purge historique doit etre traitee comme une operation de securite coordonnee, pas comme une correction Git ordinaire. Le HEAD courant est sain, mais l'historique expose reste un risque tant que les branches, tags, clones et caches peuvent atteindre l'ancien blob. La publication de l'historique purge doit rester bloquee jusqu'a mise en prive du depot, validation interne et verification dans un clone frais.
