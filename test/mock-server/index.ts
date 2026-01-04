import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

// Types matching cikada-requirements
interface HelloMessage {
  type: 'hello';
  hostname: string;
  version: string;
  capabilities: string[];
}

interface TymbalMessage {
  type: 'tymbal';
  threadId: string;
  frame: string;
}

interface ContainerStatusMessage {
  type: 'containerStatus';
  threadId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  containerId?: string;
}

interface ErrorMessage {
  type: 'error';
  threadId?: string;
  code: string;
  message: string;
}

interface StatusResponseMessage {
  type: 'statusResponse';
  requestId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'unknown';
  containerId?: string;
}

type ProviderMessage =
  | HelloMessage
  | { type: 'pong' }
  | TymbalMessage
  | ContainerStatusMessage
  | ErrorMessage
  | StatusResponseMessage;

interface ProviderConnection {
  ws: WebSocket;
  providerId: string;
  hostname?: string;
  ready: boolean;
}

export class MockCikadaServer {
  private wss: WebSocketServer | null = null;
  private providers: Map<string, ProviderConnection> = new Map();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  // Event handlers for testing
  public onProviderConnected?: (providerId: string, hostname: string) => void;
  public onTymbalFrame?: (threadId: string, frame: string) => void;
  public onContainerStatus?: (threadId: string, status: string) => void;
  public onError?: (error: ErrorMessage) => void;

  start(port: number = 8080): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port });

      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });

      this.wss.on('listening', () => {
        console.log(`Mock Cikada server listening on ws://localhost:${port}`);
        resolve();
      });

      // Start ping interval
      this.pingInterval = setInterval(() => {
        this.sendPingToAll();
      }, 30000);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
      }

      if (this.wss) {
        this.wss.close(() => {
          console.log('Mock server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(ws: WebSocket, req: { headers: { authorization?: string } }): void {
    const providerId = randomUUID();
    const connection: ProviderConnection = {
      ws,
      providerId,
      ready: false,
    };

    this.providers.set(providerId, connection);
    console.log(`Provider connected: ${providerId}`);

    // Send welcome immediately
    this.send(ws, { type: 'welcome' });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ProviderMessage;
        this.handleMessage(providerId, message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.on('close', () => {
      console.log(`Provider disconnected: ${providerId}`);
      this.providers.delete(providerId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for ${providerId}:`, error);
    });
  }

  private handleMessage(providerId: string, message: ProviderMessage): void {
    const connection = this.providers.get(providerId);
    if (!connection) return;

    switch (message.type) {
      case 'hello':
        this.handleHello(connection, message);
        break;

      case 'pong':
        // Keepalive response, nothing to do
        break;

      case 'tymbal':
        console.log(`Tymbal frame from ${message.threadId}:`, message.frame.substring(0, 100));
        this.onTymbalFrame?.(message.threadId, message.frame);
        break;

      case 'containerStatus':
        console.log(`Container ${message.threadId}: ${message.status}`);
        this.onContainerStatus?.(message.threadId, message.status);
        break;

      case 'error':
        console.error(`Error from provider:`, message);
        this.onError?.(message);
        break;

      case 'statusResponse':
        console.log(`Status response for ${message.requestId}: ${message.status}`);
        break;

      default:
        console.warn('Unknown message type:', (message as { type: string }).type);
    }
  }

  private handleHello(connection: ProviderConnection, message: HelloMessage): void {
    connection.hostname = message.hostname;
    connection.ready = true;

    console.log(`Provider ${connection.providerId} registered as "${message.hostname}"`);
    console.log(`  Version: ${message.version}`);
    console.log(`  Capabilities: ${message.capabilities.join(', ')}`);

    // Send ready response
    this.send(connection.ws, {
      type: 'ready',
      providerId: connection.providerId,
      displayName: message.hostname,
    });

    this.onProviderConnected?.(connection.providerId, message.hostname);
  }

  private send(ws: WebSocket, message: object): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendPingToAll(): void {
    for (const connection of this.providers.values()) {
      if (connection.ready) {
        this.send(connection.ws, { type: 'ping' });
      }
    }
  }

  // --- Test Commands ---

  sendMessage(
    threadId: string,
    content: string,
    options: {
      image?: string;
      systemPrompt?: string;
    } = {}
  ): string {
    const requestId = randomUUID();
    const message = {
      type: 'sendMessage',
      requestId,
      threadId,
      content,
      image: options.image ?? 'ghcr.io/cikada/claude-code:latest',
      systemPrompt: options.systemPrompt,
    };

    // Send to first ready provider
    for (const connection of this.providers.values()) {
      if (connection.ready) {
        console.log(`Sending message to ${connection.providerId}: ${content.substring(0, 50)}...`);
        this.send(connection.ws, message);
        return requestId;
      }
    }

    throw new Error('No ready providers');
  }

  stopThread(threadId: string, reason?: string): string {
    const requestId = randomUUID();
    const message = {
      type: 'stopThread',
      requestId,
      threadId,
      reason,
    };

    for (const connection of this.providers.values()) {
      if (connection.ready) {
        this.send(connection.ws, message);
        return requestId;
      }
    }

    throw new Error('No ready providers');
  }

  getStatus(threadId: string): string {
    const requestId = randomUUID();
    const message = {
      type: 'getStatus',
      requestId,
      threadId,
    };

    for (const connection of this.providers.values()) {
      if (connection.ready) {
        this.send(connection.ws, message);
        return requestId;
      }
    }

    throw new Error('No ready providers');
  }

  disconnect(reason: string): void {
    const message = { type: 'disconnect', reason };

    for (const connection of this.providers.values()) {
      this.send(connection.ws, message);
    }
  }

  getConnectedProviders(): string[] {
    return Array.from(this.providers.values())
      .filter((p) => p.ready)
      .map((p) => p.hostname ?? p.providerId);
  }
}

// CLI runner
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const server = new MockCikadaServer();

  server.onProviderConnected = (id, hostname) => {
    console.log(`\n✓ Provider "${hostname}" is ready!`);
    console.log('  Commands:');
    console.log('  - Type a message to send to the provider');
    console.log('  - "stop <threadId>" to stop a thread');
    console.log('  - "status <threadId>" to get status');
    console.log('  - "quit" to exit\n');
  };

  server.onTymbalFrame = (threadId, frame) => {
    try {
      const parsed = JSON.parse(frame);
      if (parsed.a) {
        // Append frame - just show the text
        process.stdout.write(parsed.a);
      } else if (parsed.t === 'set' && parsed.v?.content) {
        console.log(`\n[${threadId}] ${parsed.v.content}`);
      }
    } catch {
      // Not JSON, just log it
      console.log(`[${threadId}] ${frame}`);
    }
  };

  server.start(8080).then(() => {
    // Simple CLI for testing
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on('line', (input: string) => {
      const trimmed = input.trim();
      if (trimmed === 'quit') {
        server.stop().then(() => process.exit(0));
        return;
      }

      if (trimmed.startsWith('stop ')) {
        const threadId = trimmed.slice(5);
        server.stopThread(threadId);
        return;
      }

      if (trimmed.startsWith('status ')) {
        const threadId = trimmed.slice(7);
        server.getStatus(threadId);
        return;
      }

      // Default: send as message
      try {
        server.sendMessage('test-channel:test-agent', trimmed);
      } catch (error) {
        console.log('No providers connected yet');
      }
    });
  });

  process.on('SIGINT', () => {
    server.stop().then(() => process.exit(0));
  });
}
