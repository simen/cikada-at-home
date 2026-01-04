// ============================================
// WebSocket Protocol Types
// Based on local-provider-spec
// ============================================

// --- Provider → Cloud Messages ---

export interface HelloMessage {
  type: 'hello';
  hostname: string;
  version: string;
  capabilities: string[];
}

export interface PongMessage {
  type: 'pong';
}

export interface ContainerStatusMessage {
  type: 'containerStatus';
  threadId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  containerId?: string;
}

export interface TymbalMessage {
  type: 'tymbal';
  threadId: string;
  frame: string; // JSON-encoded Tymbal frame
}

export interface ErrorMessage {
  type: 'error';
  threadId?: string;
  code: string;
  message: string;
}

export interface StatusResponseMessage {
  type: 'statusResponse';
  requestId: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'unknown';
  containerId?: string;
}

export type ProviderToCloudMessage =
  | HelloMessage
  | PongMessage
  | ContainerStatusMessage
  | TymbalMessage
  | ErrorMessage
  | StatusResponseMessage;

// --- Cloud → Provider Messages ---

export interface WelcomeMessage {
  type: 'welcome';
}

export interface ReadyMessage {
  type: 'ready';
  providerId: string;
  displayName: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SendMessageCommand {
  type: 'sendMessage';
  requestId: string;
  threadId: string;
  content: string;
  image: string;
  mcpServers?: McpServerConfig[];
  systemPrompt?: string;
}

export interface StopThreadCommand {
  type: 'stopThread';
  requestId: string;
  threadId: string;
  reason?: string;
}

export interface GetStatusCommand {
  type: 'getStatus';
  requestId: string;
  threadId: string;
}

export interface DisconnectCommand {
  type: 'disconnect';
  reason: string;
}

export type CloudToProviderMessage =
  | WelcomeMessage
  | ReadyMessage
  | PingMessage
  | SendMessageCommand
  | StopThreadCommand
  | GetStatusCommand
  | DisconnectCommand;

// --- Container Types ---

export type ContainerState = 'starting' | 'running' | 'stopping' | 'stopped';

export interface ContainerInfo {
  threadId: string;
  containerId: string;
  state: ContainerState;
  endpoint: string;
  startedAt: Date;
}

// --- Auth Types ---

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp
}

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

// --- Provider Config ---

export interface ProviderConfig {
  cloudUrl?: string; // Default: wss://api.cikada.dev/provider/ws
  authUrl?: string; // Default: https://api.cikada.dev/oauth
  workspacesDir?: string; // Default: ~/.cikada/workspaces
  credentialsPath?: string; // Default: ~/.cikada/credentials.json
  statePath?: string; // Default: ~/.cikada/state.db
}
