import { safeStorage } from 'electron';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function credentials(folder) {
  const pathFor = (name) => join(folder, name + '.credential');
  let pending = Promise.resolve();

  async function read(name) {
    try {
      const { result } = await safeStorage.decryptStringAsync(await readFile(pathFor(name)));
      return JSON.parse(result);
    } catch {
      return null;
    }
  }

  function write(name, value) {
    const task = pending.then(async () => {
      const path = pathFor(name);
      if (value === null) {
        await rm(path, { force: true });
        return;
      }
      const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
      const staging = path + '.tmp';
      try {
        await writeFile(staging, encrypted);
        await rename(staging, path);
      } finally {
        await rm(staging, { force: true });
      }
    });
    pending = task.catch(() => {});
    return task;
  }

  return { read, write };
}
