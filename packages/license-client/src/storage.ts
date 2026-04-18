import type { LicenseStorage, PersistedState } from './types';

/**
 * Node file-backed storage. Writes atomically via tmpfile + rename so
 * a crash mid-write doesn't leave a corrupted state file. The file is
 * plaintext JSON — for an additional confidentiality layer, use
 * Electron's safeStorage (desktop) or wrap this in your own encrypter.
 */
export function fileStorage(path: string): LicenseStorage {
  return {
    read: async (): Promise<PersistedState | null> => {
      const { readFile } = await import('node:fs/promises');
      try {
        const raw = await readFile(path, 'utf8');
        return JSON.parse(raw) as PersistedState;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return null;
        throw err;
      }
    },
    write: async (state: PersistedState): Promise<void> => {
      const { writeFile, rename, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state), 'utf8');
      await rename(tmp, path);
    },
    clear: async (): Promise<void> => {
      const { unlink } = await import('node:fs/promises');
      await unlink(path).catch(() => { /* already gone */ });
    },
  };
}

/**
 * In-memory storage. Useful for tests and for short-lived processes
 * that don't need persistence (e.g. a build-time license check).
 */
export function memoryStorage(initial?: PersistedState | null): LicenseStorage {
  let state: PersistedState | null = initial ?? null;
  return {
    read: () => state,
    write: (next) => { state = next; },
    clear: () => { state = null; },
  };
}
