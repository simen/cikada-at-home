import open from 'open';
import type { Credentials, DeviceCodeResponse } from '../types.js';

const AUTH_BASE_URL = 'https://api.cikada.dev/oauth';
const POLL_INTERVAL_MS = 5000;

export class DeviceAuthFlow {
  async authenticate(): Promise<Credentials> {
    // 1. Request device code
    const deviceCode = await this.requestDeviceCode();

    console.log('\n========================================');
    console.log('To authenticate, visit:');
    console.log(`  ${deviceCode.verificationUri}`);
    console.log('\nAnd enter the code:');
    console.log(`  ${deviceCode.userCode}`);
    console.log('========================================\n');

    // 2. Open browser automatically
    try {
      await open(deviceCode.verificationUri);
    } catch {
      // Browser open failed, user can manually navigate
    }

    // 3. Poll for token
    return this.pollForToken(deviceCode);
  }

  async refreshToken(refreshToken: string): Promise<Credentials> {
    const response = await fetch(`${AUTH_BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  private async requestDeviceCode(): Promise<DeviceCodeResponse> {
    const response = await fetch(`${AUTH_BASE_URL}/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'cikada-provider',
        scope: 'provider',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to request device code: ${response.status}`);
    }

    const data = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    };

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval || POLL_INTERVAL_MS / 1000,
    };
  }

  private async pollForToken(deviceCode: DeviceCodeResponse): Promise<Credentials> {
    const expiresAt = Date.now() + deviceCode.expiresIn * 1000;
    const interval = Math.max(deviceCode.interval * 1000, POLL_INTERVAL_MS);

    while (Date.now() < expiresAt) {
      await new Promise((r) => setTimeout(r, interval));

      try {
        const response = await fetch(`${AUTH_BASE_URL}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode.deviceCode,
            client_id: 'cikada-provider',
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + data.expires_in * 1000,
          };
        }

        const error = (await response.json()) as { error: string };

        if (error.error === 'authorization_pending') {
          // User hasn't approved yet, keep polling
          process.stdout.write('.');
          continue;
        }

        if (error.error === 'slow_down') {
          // Slow down polling
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        throw new Error(`Token request failed: ${error.error}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('Token request failed')) {
          throw error;
        }
        // Network error, retry
        continue;
      }
    }

    throw new Error('Device code expired. Please try again.');
  }
}
