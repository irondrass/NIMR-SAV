function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createMemoryIndexedDb() {
  const databases = new Map();
  let failNextTransaction = false;
  let failNextWriteTransaction = false;
  let delayNextTransactionMs = 0;
  let delayedTransactionStarted = Promise.resolve();
  let resolveDelayedTransactionStarted = null;

  function createDatabase(name, version) {
    const stores = new Map();
    const database = {
      name,
      version,
      stores,
      objectStoreNames: { contains: (storeName) => stores.has(storeName) },
      createObjectStore(storeName, options = {}) {
        const entries = new Map();
        const definition = { entries, keyPath: options.keyPath || null, indexes: new Map() };
        stores.set(storeName, definition);
        return {
          createIndex(indexName, keyPath, indexOptions = {}) {
            definition.indexes.set(indexName, { keyPath, ...indexOptions });
          },
        };
      },
      transaction(storeNames, mode) {
        const shouldFail = failNextTransaction || (failNextWriteTransaction && mode === "readwrite");
        const completionDelay = delayNextTransactionMs;
        failNextTransaction = false;
        if (mode === "readwrite") failNextWriteTransaction = false;
        delayNextTransactionMs = 0;
        if (mode === "readwrite" && completionDelay > 0) {
          resolveDelayedTransactionStarted?.();
          resolveDelayedTransactionStarted = null;
        }
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const working = new Map(names.map((storeName) => {
          const definition = stores.get(storeName);
          if (!definition) throw new Error(`Missing object store: ${storeName}`);
          return [storeName, new Map([...definition.entries].map(([key, value]) => [key, clone(value)]))];
        }));
        let pending = 0;
        let scheduled = false;
        let failed = null;
        const transaction = {
          mode,
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore(storeName) {
            const definition = stores.get(storeName);
            const entries = working.get(storeName);
            if (!definition || !entries) throw new Error(`Store not in transaction: ${storeName}`);
            const request = (operation) => {
              const result = {};
              pending += 1;
              queueMicrotask(() => {
                try {
                  result.result = operation();
                  result.onsuccess?.();
                } catch (error) {
                  failed = error;
                  result.error = error;
                  result.onerror?.();
                } finally {
                  pending -= 1;
                  scheduleCompletion();
                }
              });
              return result;
            };
            return {
              put(value) {
                const copy = clone(value);
                return request(() => {
                  const key = definition.keyPath ? copy[definition.keyPath] : undefined;
                  if (key === undefined || key === null || key === "") throw new Error(`Missing keyPath ${definition.keyPath}`);
                  entries.set(key, copy);
                  return key;
                });
              },
              get(key) { return request(() => clone(entries.get(key))); },
              getAll() { return request(() => [...entries.values()].map(clone)); },
              delete(key) { return request(() => entries.delete(key)); },
              clear() { return request(() => entries.clear()); },
            };
          },
          abort() {
            failed = new Error("Transaction aborted");
            transaction.error = failed;
            scheduleCompletion();
          },
        };
        function scheduleCompletion() {
          if (scheduled || pending) return;
          scheduled = true;
          setTimeout(() => {
            if (shouldFail) failed = new Error("Injected transaction failure");
            if (failed) {
              transaction.error = failed;
              transaction.onerror?.();
              return;
            }
            working.forEach((entries, storeName) => {
              stores.get(storeName).entries = entries;
            });
            transaction.oncomplete?.();
          }, completionDelay);
        }
        setTimeout(scheduleCompletion, 0);
        return transaction;
      },
      close() {},
    };
    databases.set(name, database);
    return database;
  }

  return {
    databases,
    failNextTransaction() { failNextTransaction = true; },
    failNextWriteTransaction() { failNextWriteTransaction = true; },
    delayNextTransaction(milliseconds) {
      delayNextTransactionMs = milliseconds;
      delayedTransactionStarted = new Promise((resolve) => {
        resolveDelayedTransactionStarted = resolve;
      });
    },
    waitForDelayedTransactionStart() { return delayedTransactionStarted; },
    open(name, version) {
      const request = {};
      setTimeout(() => {
        let database = databases.get(name);
        const needsUpgrade = !database || Number(version) > Number(database.version || 0);
        if (!database) database = createDatabase(name, version);
        if (needsUpgrade) {
          database.version = version;
          request.result = database;
          request.onupgradeneeded?.();
        }
        request.result = database;
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}
