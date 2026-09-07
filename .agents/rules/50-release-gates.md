# RULE 50: NIMR-SAV RELEASE & PRODUCTION VERIFICATION GATES

## 1. Pre-Merge Release Gate
Before merging into `main`:
1. Verify target branch is `main` and merge base is clean.
2. Verify all quality gates for the targeted scope are 100% green.
3. Verify release version consistency across all declaring files:
   - `js/version.js` (`APP_VERSION`, `NIMR_BUILD`, `NIMR_CACHE_NAME`)
   - `sw.js` (`CACHE_NAME`, asset query strings `?v=...`)
   - `index.html` (script/style query strings `?v=...`)
   - `manifest.webmanifest`
   - `apps/nimr-sav-react/package.json` (for V24 releases)
4. Verify release fingerprint contract:
   - `node --test tests/release_fingerprint_portability.test.mjs`
   - `node --test tests/pwa_cache_version_contract.test.mjs`

## 2. Post-Merge Gate
After merge into `main`:
1. Verify commit exists on remote `origin/main`.
2. Verify automated CI / GitHub Actions build status is green.
3. Ensure no dangling release branches or unmerged staging commits.

## 3. Production Verification Gate
After deployment to GitHub Pages or production hosting:
1. Verify served `index.html` serves the expected version string.
2. Verify Service Worker installs and activates the exact matching cache name.
3. Verify no cache corruption or mixed-version assets.
4. Execute non-destructive production smoke check:
   - Shell renders without unhandled exceptions.
   - Authentication gate functions as expected.
   - Offline fallback functions properly.
5. Never declare production verified without live verification evidence.
