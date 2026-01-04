import WebSocket from 'ws';
import { hostname } from 'node:os';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const PROVIDER_VERSION = '0.1.0';
export class WebSocketClient {
    config;
    ws = null;
    reconnectAttempt = 0;
    shouldReconnect = true;
    reconnectTimer = null;
    constructor(config) {
        this.config = config;
    }
    async connect() {
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
                        const message = JSON.parse(data.toString());
                        this.handleMessage(message);
                    }
                    catch (error) {
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
            }
            catch (error) {
                reject(error);
            }
        });
    }
    send(message) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
    async disconnect() {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
    sendHello() {
        const hello = {
            type: 'hello',
            hostname: hostname(),
            version: PROVIDER_VERSION,
            capabilities: ['docker', 'claude-code'],
        };
        this.send(hello);
    }
    handleMessage(message) {
        // Handle ping/pong internally
        if (message.type === 'ping') {
            this.send({ type: 'pong' });
            return;
        }
        // Forward other messages to router
        this.config.onMessage(message);
    }
    scheduleReconnect() {
        if (!this.shouldReconnect)
            return;
        const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
        console.log(`Reconnecting in ${delay / 1000}s...`);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectAttempt++;
            try {
                await this.connect();
            }
            catch {
                // Will retry via close handler
            }
        }, delay);
    }
}
//# sourceMappingURL=websocket-client.js.map