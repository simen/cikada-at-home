import WebSocket from 'ws';
import { hostname } from 'node:os';
import type {
  CloudToProviderMessage,
  ProviderToCloudMessage,
  HelloMessage,
} from '../types.js';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const PROVIDER_VERSION = '0.1.0';

export interface WebSocketClientConfig {
  url: string;
  accessToken: string;
  onMessage: (message: CloudToProviderMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export class WebSocketClient {
  private config: WebSocketClientConfig;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: WebSocketClientConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url, {
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
          },
        });

        this.ws.on('open', () => {
          this.reconnectAttempt = 0;
          this.sendHello();
          this.config.onConnected?.();
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as CloudToProviderMessage;
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse message:', error);
          }
        });

        this.ws.on('close', () => {
          this.config.onDisconnected?.();
          this.scheduleReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error.message);
          if (this.reconnectAttempt === 0) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  send(message: ProviderToCloudMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private sendHello(): void {
    const hello: HelloMessage = {
      type: 'hello',
      hostname: hostname(),
      version: PROVIDER_VERSION,
      capabilities: ['docker', 'claude-code'],
    };
    this.send(hello);
  }

  private handleMessage(message: CloudToProviderMessage): void {
    // Handle ping/pong internally
    if (message.type === 'ping') {
      this.send({ type: 'pong' });
      return;
    }

    // Forward other messages to router
    this.config.onMessage(message);
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    console.log(`Reconnecting in ${delay / 1000}s...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempt++;
      try {
        await this.connect();
      } catch {
        // Will retry via close handler
      }
    }, delay);
  }
}
