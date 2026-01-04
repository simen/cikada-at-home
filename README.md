# @cikada/provider

Local provider for running Cikada agents on your machine.

## Quick Start

```bash
npm install
npm run build
npm start
```

On first run, opens browser for authentication.

## Development

```bash
npm run dev      # Watch mode
npm test         # Run tests
npm run lint     # Lint code
```

## Architecture

```
src/
  cli.ts              # CLI entry point
  provider.ts         # Main provider class
  client/
    websocket-client.ts   # WebSocket connection to cloud
    message-router.ts     # Routes cloud messages to orchestrator
  orchestrator/
    docker-orchestrator.ts  # Manages Docker containers
    state-store.ts          # SQLite persistence
  auth/
    credential-store.ts     # Token storage
    device-auth-flow.ts     # OAuth device flow
  types.ts            # TypeScript types
```

## Testing

Tests use a mock WebSocket server in `test/mock-server/`.

```bash
npm test
```
