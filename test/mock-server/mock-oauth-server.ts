import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

interface DeviceCode {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  approved: boolean;
}

export class MockOAuthServer {
  private server: ReturnType<typeof createServer> | null = null;
  private deviceCodes: Map<string, DeviceCode> = new Map();

  start(port: number = 8081): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(port, () => {
        console.log(`Mock OAuth server listening on http://localhost:${port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // Manually approve a device code (simulates user clicking "approve" in browser)
  approveDeviceCode(userCode: string): boolean {
    for (const code of this.deviceCodes.values()) {
      if (code.userCode === userCode) {
        code.approved = true;
        console.log(`Device code ${userCode} approved`);
        return true;
      }
    }
    return false;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      this.sendError(res, 405, 'method_not_allowed');
      return;
    }

    const body = await this.readBody(req);

    try {
      if (url.pathname === '/oauth/device/code') {
        this.handleDeviceCode(res, body);
      } else if (url.pathname === '/oauth/token') {
        this.handleToken(res, body);
      } else {
        this.sendError(res, 404, 'not_found');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      this.sendError(res, 500, 'server_error');
    }
  }

  private handleDeviceCode(res: ServerResponse, body: Record<string, unknown>): void {
    const deviceCode = randomUUID();
    const userCode = this.generateUserCode();

    const code: DeviceCode = {
      deviceCode,
      userCode,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      approved: false,
    };

    this.deviceCodes.set(deviceCode, code);

    console.log(`\n========================================`);
    console.log(`Device code requested. User code: ${userCode}`);
    console.log(`To approve, run: server.approveDeviceCode("${userCode}")`);
    console.log(`Or in the CLI: approve ${userCode}`);
    console.log(`========================================\n`);

    this.sendJson(res, {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: 'http://localhost:8081/verify',
      expires_in: 600,
      interval: 5,
    });
  }

  private handleToken(res: ServerResponse, body: Record<string, unknown>): void {
    const grantType = body.grant_type as string;

    if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
      this.handleDeviceCodeGrant(res, body.device_code as string);
    } else if (grantType === 'refresh_token') {
      this.handleRefreshToken(res, body.refresh_token as string);
    } else {
      this.sendError(res, 400, 'unsupported_grant_type');
    }
  }

  private handleDeviceCodeGrant(res: ServerResponse, deviceCode: string): void {
    const code = this.deviceCodes.get(deviceCode);

    if (!code) {
      this.sendError(res, 400, 'invalid_grant');
      return;
    }

    if (code.expiresAt < Date.now()) {
      this.deviceCodes.delete(deviceCode);
      this.sendError(res, 400, 'expired_token');
      return;
    }

    if (!code.approved) {
      // User hasn't approved yet
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'authorization_pending' }));
      return;
    }

    // Approved! Issue tokens
    this.deviceCodes.delete(deviceCode);

    this.sendJson(res, {
      access_token: `mock_access_${randomUUID()}`,
      refresh_token: `mock_refresh_${randomUUID()}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  private handleRefreshToken(res: ServerResponse, refreshToken: string): void {
    // Accept any refresh token for testing
    if (!refreshToken?.startsWith('mock_refresh_')) {
      this.sendError(res, 400, 'invalid_grant');
      return;
    }

    this.sendJson(res, {
      access_token: `mock_access_${randomUUID()}`,
      refresh_token: `mock_refresh_${randomUUID()}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  private generateUserCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      if (i === 4) code += '-';
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });
  }

  private sendJson(res: ServerResponse, data: object): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  private sendError(res: ServerResponse, status: number, error: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  }
}

// CLI runner
if (process.argv[1]?.endsWith('mock-oauth-server.ts') || process.argv[1]?.endsWith('mock-oauth-server.js')) {
  const server = new MockOAuthServer();

  server.start(8081).then(() => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('Commands:');
    console.log('  approve <user-code>  - Approve a pending device code');
    console.log('  quit                 - Exit\n');

    rl.on('line', (input: string) => {
      const trimmed = input.trim();

      if (trimmed === 'quit') {
        server.stop().then(() => process.exit(0));
        return;
      }

      if (trimmed.startsWith('approve ')) {
        const userCode = trimmed.slice(8).toUpperCase();
        if (server.approveDeviceCode(userCode)) {
          console.log('Approved!');
        } else {
          console.log('Code not found');
        }
        return;
      }

      console.log('Unknown command');
    });
  });

  process.on('SIGINT', () => {
    server.stop().then(() => process.exit(0));
  });
}
