# NIMR SAV v23.3.34

Cette version complète les corrections de l’audit UX / métier : arrivée sans devis, opérations PDF distinctes, suivi des engagements client, liste Aujourd’hui unique, actions contextuelles, file CQ spécialisée, disponibilité réelle et quatre indicateurs de pilotage. Les prévisions ne modifient plus les dates acceptées. La reprise hors ligne actualise aussi l’état réseau de la fiche technicien.

La migration Supabase `20260906001634_audit_completion_private_api.sql` est appliquée et vérifiée en production avec des données synthétiques annulées. Elle réduit l’exposition des fonctions privilégiées, protège les promesses client et la finalisation, et complète les index des clés étrangères.

Recette reproductible : `node tests/run-audit-release.mjs`. Détail des 20 points, preuves et limites dans [le relevé de clôture](docs/cloture-audit-v23.3.34.md). La protection Supabase contre les mots de passe compromis reste liée à une offre payante ; aucune souscription n’a été engagée.
