# KHA-76 — Contrat visuel : conserver le thème MagicPath NIMR Design System v1

**Référence de vérité (pas une nouvelle identité graphique)** : projet MagicPath existant **NIMR-SAV Planning UX**, ID `455446340235857920`, composant **NIMR Design System v1**, component ID `455599195064250368`, révision visible sur canvas `455610464903254016`. Aperçu effectivement lu depuis le composant existant. Ne pas remplacer le Design System par le thème bleu initial de la maquette KHA-76.

## Palette de la référence

Les trois premières couleurs ont été relevées directement sur les pixels unis de l'aperçu MagicPath du DS v1 du 30/09/2026 :

| Usage | Valeur | Source |
|---|---|---|
| Sidebar anthracite | `#111C24` | pixel dans la navigation MagicPath |
| Fond espace de travail | `#F5F7F9` | pixel du canvas principal |
| CTA principal rouge NIMR | `#D7262E` | pixel du bouton « + Nouveau dossier » |
| Surface topbar / cartes | `#FFFFFF` | pixel du corps de la carte |
| Texte principal | `#202B37` | approximation visuelle à vérifier sur code du thème dès retour quota |
| Bordure cartes | `#DCE4EF` | approximation visuelle à vérifier dès retour quota |
| Texte secondaire | `#677C99` | approximation visuelle ; conserver une couleur à contraste lisible |

**Composition obligatoire** : colonne latérale anthracite ~250 px avec marque NIMR SAV / « Opérations après-vente » ; navigation Dashboard / Réception / Dossiers / Atelier / Planning / Qualité / Pièces / Garantie ; entrée Garantie active sous forme de pilule blanche avec un point rouge ; haut de la zone métier blanc avec sourcil « NIMR DESIGN SYSTEM V1 », titre métier et CTA rouge (uniquement lorsque l'action est réellement autorisée) ; contenu fond gris très clair, cartes blanches bordées, typographie Inter/sans de système, tableaux denses et lignes de séparation discrètes. **Ne pas inventer une seconde palette Garantie.**

**États métier** : le rouge NIMR est la couleur d'action, *pas* un synonyme universel d'erreur. Les statuts utilisent des fonds pastel lisibles (bleu en revue, ambre attente, vert terminé, rouge explicite pour refus/blocage), avec leur libellé textuel, sans dépendre de la couleur seule. Internes, OEM, Finance et Réseau ne doivent pas être confondus.

**Responsive** : desktop barre latérale 250 px ; largeur réduite tablette ; mobile `<= 760 px` avec bandeau anthracite compact (marque + section active) plutôt que sidebar horizontale trop large ; cartes 4→2→2, diagnostic 2→1 et onglets défilants. Tests navigateur réels à faire aux largeurs 1440, 1024, 768 et 390 px.

## État réel de la mise en œuvre

- Fichier Figma : https://www.figma.com/design/UQDEtBoX0RbMZs1oxlMilM . Les neuf maquettes UX créées au lot précédent restent éditables.
- **Écran Figma 01 Agence — Mes demandes (node `1:2`)** : sa structure a été convertie vers le shell MagicPath (sidebar, header blanc, CTA rouge, cartes). L'écriture via Figma a réussi, mais la capture de vérification a été bloquée ensuite par la limite d'appels MCP Starter. **Ne pas déclarer revue visuelle PASS.**
- **Écrans Figma 02–09** : harmonisation à terminer une fois Figma MCP disponible. Les écrans existent mais peuvent encore refléter l'ancienne palette. Ne pas conclure « tous les écrans harmonisés ».
- **React isolé KHA-76** : `apps/nimr-sav-react/src/features/warranty-network/WarrantyNetworkWorkspace.tsx` et `warranty-network.css` utilisent le shell et les valeurs référencées ci-dessus ; test de non-régression dans `tests/warranty-network-ui.test.tsx`. Ce composant **n'est pas routé ni connecté**, pour conserver le gel alpha.20 des 8 rôles et les gates auth/RLS STAGING.
- Aucun changement de PROD, de données réelles, de déploiement ni de décision constructeur/Finance.

## Conditions d'acceptation avant intégration finale

Contrôler l'écran Figma 01 après renouvellement de quota et corriger toute troncature/overlap. Appliquer le même shell à 02–08 et adapter 09 mobile. Vérifier que les boutons non branchés ne simulent pas un envoi, une réception centrale, une approbation ou un mouvement de stock. Puis comparer Figma vs rendu navigateur du React isolé à 1440/1024/768/390 et relever les défauts visuels ; seulement ensuite proposer un GO UX.
