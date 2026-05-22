import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = [
  '../js/state.js',
  '../js/utils.js',
  '../js/supabase-sync.js',
]
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');

const storage = new Map();
const context = {
  console,
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  window: {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: () => {},
  },
  document: {
    addEventListener: () => {},
    visibilityState: 'visible',
  },
  navigator: { onLine: true },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  Date,
};

vm.createContext(context);
vm.runInContext(source, context);

const cloudDeletionWinsRefresh = JSON.parse(vm.runInContext(`(() => {
  state = normalizeState({
    updatedAt: '2026-05-22T11:55:00.000Z',
    cases: [{ id: 'case-local-stale', clientName: 'Ancien dossier local', plate: '5544TU243' }],
  });
  lastKnownCloudUpdatedAt = new Date('2026-05-22T11:40:00.000Z').getTime();
  const remote = {
    updated_at: '2026-05-22T11:50:00.000Z',
    state: { updatedAt: '2026-05-22T11:50:00.000Z', cases: [] },
  };
  return JSON.stringify({ shouldApply: shouldApplyRemoteBackup(remote) });
})()`, context));

assert.equal(
  cloudDeletionWinsRefresh.shouldApply,
  true,
  'une suppression cloud plus récente doit être appliquée même si la sauvegarde locale de rafraîchissement est datée après',
);

const sameCloudIgnored = JSON.parse(vm.runInContext(`(() => {
  lastKnownCloudUpdatedAt = new Date('2026-05-22T11:50:00.000Z').getTime();
  const remote = {
    updated_at: '2026-05-22T11:50:00.000Z',
    state: { updatedAt: '2026-05-22T11:50:00.000Z', cases: [] },
  };
  return JSON.stringify({ shouldApply: shouldApplyRemoteBackup(remote) });
})()`, context));

assert.equal(sameCloudIgnored.shouldApply, false, 'la même sauvegarde cloud ne doit pas être réappliquée en boucle');

console.log('Supabase sync regression OK');
