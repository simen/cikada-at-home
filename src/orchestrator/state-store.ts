import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ContainerInfo, ContainerState } from '../types.js';

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers (
        thread_id TEXT PRIMARY KEY,
        container_id TEXT NOT NULL,
        state TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        started_at TEXT NOT NULL
      )
    `);
  }

  async saveContainer(container: ContainerInfo): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO containers (thread_id, container_id, state, endpoint, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      container.threadId,
      container.containerId,
      container.state,
      container.endpoint,
      container.startedAt.toISOString()
    );
  }

  async getContainer(threadId: string): Promise<ContainerInfo | null> {
    const stmt = this.db.prepare('SELECT * FROM containers WHERE thread_id = ?');
    const row = stmt.get(threadId) as {
      thread_id: string;
      container_id: string;
      state: string;
      endpoint: string;
      started_at: string;
    } | undefined;

    if (!row) return null;

    return {
      threadId: row.thread_id,
      containerId: row.container_id,
      state: row.state as ContainerState,
      endpoint: row.endpoint,
      startedAt: new Date(row.started_at),
    };
  }

  async removeContainer(threadId: string): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM containers WHERE thread_id = ?');
    stmt.run(threadId);
  }

  async listContainers(): Promise<ContainerInfo[]> {
    const stmt = this.db.prepare('SELECT * FROM containers');
    const rows = stmt.all() as Array<{
      thread_id: string;
      container_id: string;
      state: string;
      endpoint: string;
      started_at: string;
    }>;

    return rows.map((row) => ({
      threadId: row.thread_id,
      containerId: row.container_id,
      state: row.state as ContainerState,
      endpoint: row.endpoint,
      startedAt: new Date(row.started_at),
    }));
  }

  close(): void {
    this.db.close();
  }
}
