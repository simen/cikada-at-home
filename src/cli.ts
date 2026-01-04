#!/usr/bin/env node

import { Provider } from './provider.js';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    workspace: { type: 'string', short: 'w' },
    'cloud-url': { type: 'string' },
    'auth-url': { type: 'string' },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`
cikada-provider - Run Cikada agents locally

Usage: cikada-provider [options]

Options:
  -h, --help       Show this help message
  -v, --version    Show version
  -w, --workspace  Workspace directory (default: ~/.cikada/workspaces)
  --cloud-url      WebSocket URL for cloud (default: wss://api.cikada.dev/provider/ws)
  --auth-url       OAuth URL (default: https://api.cikada.dev/oauth)

Environment Variables:
  CIKADA_CLOUD_URL  Override cloud WebSocket URL
  CIKADA_AUTH_URL   Override OAuth URL

On first run, opens browser for authentication.
`);
  process.exit(0);
}

if (values.version) {
  console.log('0.1.0');
  process.exit(0);
}

async function main() {
  console.log('Starting Cikada Provider...');

  const provider = new Provider({
    workspacesDir: values.workspace,
    cloudUrl: values['cloud-url'] ?? process.env.CIKADA_CLOUD_URL,
    authUrl: values['auth-url'] ?? process.env.CIKADA_AUTH_URL,
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await provider.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await provider.shutdown();
    process.exit(0);
  });

  try {
    await provider.start();
  } catch (error) {
    console.error('Failed to start provider:', error);
    process.exit(1);
  }
}

main();
