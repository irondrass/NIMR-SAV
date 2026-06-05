# Sécurité Supabase Storage - repair-photos

## Risque identifié

Le bucket privé `repair-photos` ne doit jamais être ouvert globalement à tous les utilisateurs `authenticated`.
Une policy limitée à `bucket_id = 'repair-photos'` permettrait à n'importe quel compte connecté au projet Supabase de lire, créer, modifier ou supprimer les photos de tous les ateliers.

## Policy recommandée

Les objets doivent être stockés avec un préfixe atelier obligatoire :

```text
<workshop_id>/<case_id>/<photo_id-or-filename>
```

Exemple :

```text
00000000-0000-0000-0000-000000000001/case-123/photo-456.jpg
```

Les policies v23.1.5 dans `supabase-schema.sql` imposent :

- bucket `repair-photos` privé ;
- premier segment du chemin convertible en UUID ;
- appartenance de `auth.uid()` à `public.workshop_members` pour ce `workshop_id` ;
- aucune policy globale `select/insert/update/delete` pour tout `authenticated`.

## Migration production

1. Exécuter `supabase-schema.sql` dans Supabase SQL Editor.
2. Vérifier dans Storage > Policies que les anciennes policies suivantes n'existent plus :
   - `repair photos read authenticated`
   - `repair photos insert authenticated`
   - `repair photos update authenticated`
   - `repair photos delete authenticated`
3. Vérifier que les nouvelles policies `repair photos * workshop member` existent.
4. Si des objets existent déjà sans préfixe `workshop_id`, les déplacer vers `<workshop_id>/...` avant d'activer les uploads directs.
5. Tester avec deux utilisateurs appartenant à deux ateliers différents : chacun doit uniquement accéder à son préfixe atelier.

## Note applicative

L'application actuelle synchronise surtout les métadonnées et sauvegardes via les tables métier. Si un upload direct vers `repair-photos` est ajouté plus tard, le chemin d'objet doit être construit avec `getSupabaseWorkshopId()` en premier segment.
