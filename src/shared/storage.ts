/**
 * Typed wrapper over chrome.storage.local.
 *
 * Convention: only the background service worker writes (UI contexts send
 * messages); every context may read and subscribe. This avoids write races
 * between the four extension contexts.
 */
import { STORAGE_DEFAULTS, type StorageShape } from './types';

type Key = keyof StorageShape;

export async function getStored<K extends Key>(key: K): Promise<StorageShape[K]> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as StorageShape[K] | undefined) ?? STORAGE_DEFAULTS[key];
}

export async function getAllStored(): Promise<StorageShape> {
  const result = await chrome.storage.local.get(null);
  return { ...STORAGE_DEFAULTS, ...result } as StorageShape;
}

/** Background-only by convention. */
export async function setStored<K extends Key>(key: K, value: StorageShape[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/** Background-only by convention. Read-modify-write helper. */
export async function updateStored<K extends Key>(
  key: K,
  fn: (current: StorageShape[K]) => StorageShape[K],
): Promise<StorageShape[K]> {
  const current = await getStored(key);
  const next = fn(current);
  await setStored(key, next);
  return next;
}

/** Subscribe to changes of a specific key. Returns an unsubscribe function. */
export function onStoredChange<K extends Key>(
  key: K,
  fn: (newValue: StorageShape[K]) => void,
): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local') return;
    const change = changes[key];
    if (change) fn((change.newValue as StorageShape[K] | undefined) ?? STORAGE_DEFAULTS[key]);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Run schema migrations. Called from background on startup/install. */
export async function migrateStorage(): Promise<void> {
  const { schemaVersion } = await chrome.storage.local.get('schemaVersion');
  if (schemaVersion === undefined) {
    await chrome.storage.local.set({ schemaVersion: STORAGE_DEFAULTS.schemaVersion });
    return;
  }
  // Future migrations: if (schemaVersion < 2) { ... }
}
