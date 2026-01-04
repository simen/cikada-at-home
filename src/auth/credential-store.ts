import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Credentials } from '../types.js';

export class CredentialStore {
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<Credentials | null> {
    try {
      const data = await readFile(this.path, 'utf-8');
      return JSON.parse(data) as Credentials;
    } catch {
      return null;
    }
  }

  async save(credentials: Credentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(credentials, null, 2), 'utf-8');
  }

  async clear(): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.path);
    } catch {
      // File doesn't exist, that's fine
    }
  }
}
