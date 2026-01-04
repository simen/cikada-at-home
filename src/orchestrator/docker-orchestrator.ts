import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContainerInfo, ContainerState, McpServerConfig } from '../types.js';
import { StateStore } from './state-store.js';

export interface DockerOrchestratorConfig {
  workspacesDir: string;
  statePath: string;
}

export interface SendMessageOptions {
  image: string;
  mcpServers?: McpServerConfig[];
  systemPrompt?: string;
  onTymbalFrame?: (frame: string) => void;
}

export class DockerOrchestrator {
  private config: DockerOrchestratorConfig;
  private stateStore: StateStore;
  private containers: Map<string, ContainerInfo> = new Map();

  constructor(config: DockerOrchestratorConfig) {
    this.config = config;
    this.stateStore = new StateStore(config.statePath);
  }

  async sendMessage(
    threadId: string,
    content: string,
    options: SendMessageOptions
  ): Promise<void> {
    let container = this.containers.get(threadId);

    if (!container || container.state !== 'running') {
      container = await this.startContainer(threadId, options);
    }

    await this.forwardMessage(container, threadId, content, options);
  }

  async stopThread(threadId: string, reason?: string): Promise<void> {
    const container = this.containers.get(threadId);
    if (!container) return;

    await this.stopContainer(container.containerId);
    this.containers.delete(threadId);
    await this.stateStore.removeContainer(threadId);
  }

  async getStatus(threadId: string): Promise<ContainerInfo | null> {
    return this.containers.get(threadId) ?? null;
  }

  async shutdown(): Promise<void> {
    // Stop all running containers
    for (const [threadId, container] of this.containers) {
      try {
        await this.stopContainer(container.containerId);
      } catch (error) {
        console.error(`Failed to stop container for ${threadId}:`, error);
      }
    }
    this.containers.clear();
    this.stateStore.close();
  }

  private async startContainer(
    threadId: string,
    options: SendMessageOptions
  ): Promise<ContainerInfo> {
    const workspaceDir = this.getWorkspaceDir(threadId);
    await mkdir(workspaceDir, { recursive: true });

    // Build docker run command
    const containerId = `cikada-${threadId.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
    const args = [
      'run',
      '-d', // Detached mode - returns after container starts
      '--rm',
      '--name', containerId,
      '-v', `${workspaceDir}:/workspace`,
      '-w', '/workspace',
      '-p', '0:8080', // Ephemeral port mapping
      options.image,
    ];

    // Start container in detached mode
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (data) => (stderr += data));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`docker run failed: ${stderr}`));
        }
      });
      proc.on('error', reject);
    });

    // Wait for container to be healthy
    const endpoint = await this.waitForHealthy(containerId);

    const container: ContainerInfo = {
      threadId,
      containerId,
      state: 'running',
      endpoint,
      startedAt: new Date(),
    };

    this.containers.set(threadId, container);
    await this.stateStore.saveContainer(container);

    return container;
  }

  private async stopContainer(containerId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['stop', containerId]);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker stop exited with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private async waitForHealthy(containerId: string, timeoutMs = 30000): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const port = await this.getContainerPort(containerId);
        if (port) {
          const endpoint = `http://localhost:${port}`;
          const healthy = await this.checkHealth(endpoint);
          if (healthy) return endpoint;
        }
      } catch {
        // Container not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(`Container ${containerId} did not become healthy within ${timeoutMs}ms`);
  }

  private async getContainerPort(containerId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const proc = spawn('docker', ['port', containerId, '8080']);
      let output = '';
      proc.stdout.on('data', (data) => (output += data));
      proc.on('close', () => {
        const match = output.match(/:(\d+)/);
        resolve(match ? match[1] : null);
      });
    });
  }

  private async checkHealth(endpoint: string): Promise<boolean> {
    try {
      const response = await fetch(`${endpoint}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async forwardMessage(
    container: ContainerInfo,
    threadId: string,
    content: string,
    options: SendMessageOptions
  ): Promise<void> {
    const response = await fetch(`${container.endpoint}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        threadId,
        resolvedMcps: options.mcpServers ?? [],
        systemPrompt: options.systemPrompt,
      }),
    });

    if (!response.ok) {
      throw new Error(`Container returned ${response.status}: ${await response.text()}`);
    }

    // Stream Tymbal frames from response
    if (response.body && options.onTymbalFrame) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        // Each line is a Tymbal frame
        for (const line of text.split('\n').filter(Boolean)) {
          options.onTymbalFrame(line);
        }
      }
    }
  }

  private getWorkspaceDir(threadId: string): string {
    // threadId format: "channel:callsign"
    const [channel, callsign] = threadId.split(':');
    return join(this.config.workspacesDir, channel, callsign);
  }
}
