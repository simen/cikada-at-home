import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketClient } from './client/websocket-client.js';
import { MessageRouter } from './client/message-router.js';
import { DockerOrchestrator } from './orchestrator/docker-orchestrator.js';
import { CredentialStore } from './auth/credential-store.js';
import { DeviceAuthFlow } from './auth/device-auth-flow.js';
import type { ProviderConfig, Credentials } from './types.js';

const DEFAULT_CLOUD_URL = 'wss://api.cikada.dev/provider/ws';
const DEFAULT_AUTH_URL = 'https://api.cikada.dev/oauth';
const CIKADA_DIR = join(homedir(), '.cikada');

export class Provider {
  private config: Required<ProviderConfig>;
  private wsClient: WebSocketClient | null = null;
  private router: MessageRouter | null = null;
  private orchestrator: DockerOrchestrator | null = null;
  private credentialStore: CredentialStore;
  private deviceAuth: DeviceAuthFlow;

  constructor(config: ProviderConfig = {}) {
    this.config = {
      cloudUrl: config.cloudUrl ?? DEFAULT_CLOUD_URL,
      authUrl: config.authUrl ?? DEFAULT_AUTH_URL,
      workspacesDir: config.workspacesDir ?? join(CIKADA_DIR, 'workspaces'),
      credentialsPath: config.credentialsPath ?? join(CIKADA_DIR, 'credentials.json'),
      statePath: config.statePath ?? join(CIKADA_DIR, 'state.db'),
    };

    this.credentialStore = new CredentialStore(this.config.credentialsPath);
    this.deviceAuth = new DeviceAuthFlow(this.config.authUrl);
  }

  async start(): Promise<void> {
    // 1. Ensure we have valid credentials
    let credentials = await this.credentialStore.load();

    if (!credentials || this.isTokenExpired(credentials)) {
      if (credentials?.refreshToken) {
        console.log('Token expired, attempting refresh...');
        try {
          credentials = await this.deviceAuth.refreshToken(credentials.refreshToken);
          await this.credentialStore.save(credentials);
        } catch {
          console.log('Refresh failed, starting new auth flow...');
          credentials = null;
        }
      }

      if (!credentials) {
        console.log('Authentication required. Opening browser...');
        credentials = await this.deviceAuth.authenticate();
        await this.credentialStore.save(credentials);
        console.log('Authentication successful!');
      }
    }

    // 2. Initialize orchestrator
    this.orchestrator = new DockerOrchestrator({
      workspacesDir: this.config.workspacesDir,
      statePath: this.config.statePath,
    });

    // 3. Initialize message router
    this.router = new MessageRouter(this.orchestrator);

    // 4. Connect to cloud
    this.wsClient = new WebSocketClient({
      url: this.config.cloudUrl,
      accessToken: credentials.accessToken,
      onMessage: (msg) => this.router!.handleMessage(msg),
      onConnected: () => console.log('Connected to Cikada cloud'),
      onDisconnected: () => console.log('Disconnected from Cikada cloud'),
    });

    this.router.setSender((msg) => this.wsClient!.send(msg));

    await this.wsClient.connect();
  }

  async shutdown(): Promise<void> {
    if (this.wsClient) {
      await this.wsClient.disconnect();
    }
    if (this.orchestrator) {
      await this.orchestrator.shutdown();
    }
  }

  private isTokenExpired(credentials: Credentials): boolean {
    // Consider expired if less than 5 minutes remaining
    return credentials.expiresAt < Date.now() + 5 * 60 * 1000;
  }
}
