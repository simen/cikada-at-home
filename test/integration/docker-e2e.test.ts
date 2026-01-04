import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { MockCikadaServer } from '../mock-server/index.js';
import { WebSocketClient } from '../../src/client/websocket-client.js';
import { MessageRouter } from '../../src/client/message-router.js';
import { DockerOrchestrator } from '../../src/orchestrator/docker-orchestrator.js';

const MOCK_AGENT_IMAGE = 'cikada-mock-agent:test';
const TEST_TIMEOUT = 60000;

describe('Docker End-to-End', () => {
  let mockServer: MockCikadaServer;
  let wsClient: WebSocketClient;
  let router: MessageRouter;
  let orchestrator: DockerOrchestrator;
  let tempDir: string;
  const port = 9095;

  beforeAll(async () => {
    // Create temp directories
    tempDir = join(tmpdir(), `cikada-e2e-${Date.now()}`);
    const workspacesDir = join(tempDir, 'workspaces');
    const statePath = join(tempDir, 'state.db');
    await mkdir(workspacesDir, { recursive: true });

    // Build mock agent Docker image
    const mockAgentDir = join(__dirname, '..', 'mock-agent');
    console.log(`Building mock agent from ${mockAgentDir}...`);

    try {
      // Use --load to ensure image is available in docker (not just buildx cache)
      execSync(`docker build --load -t ${MOCK_AGENT_IMAGE} ${mockAgentDir}`, {
        stdio: 'inherit',
      });
    } catch (error) {
      console.error('Failed to build mock agent image');
      throw error;
    }

    // Start mock Cikada server
    mockServer = new MockCikadaServer();
    await mockServer.start(port);

    // Initialize orchestrator
    orchestrator = new DockerOrchestrator({
      workspacesDir,
      statePath,
    });

    // Initialize message router
    router = new MessageRouter(orchestrator);

    // Connect WebSocket client
    wsClient = new WebSocketClient({
      url: `ws://localhost:${port}`,
      accessToken: 'test-token',
      onMessage: (msg) => router.handleMessage(msg),
      onConnected: () => console.log('Provider connected'),
    });

    router.setSender((msg) => wsClient.send(msg));

    await wsClient.connect();

    // Wait for handshake
    await new Promise((r) => setTimeout(r, 200));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Cleanup
    await wsClient?.disconnect();
    await orchestrator?.shutdown();
    await mockServer?.stop();

    // Remove temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Optionally remove Docker image
    try {
      execSync(`docker rmi ${MOCK_AGENT_IMAGE}`, { stdio: 'ignore' });
    } catch {
      // Image may not exist or be in use
    }
  }, TEST_TIMEOUT);

  it('should provision container and receive tymbal frames', async () => {
    const threadId = 'e2e-test:agent';
    const receivedFrames: string[] = [];
    const statusUpdates: string[] = [];

    // Create test files in workspace before container starts
    // The workspace path follows the pattern: workspacesDir/channel/callsign
    const [channel, callsign] = threadId.split(':');
    const workspaceDir = join(tempDir, 'workspaces', channel, callsign);
    await mkdir(workspaceDir, { recursive: true });
    await writeFile(join(workspaceDir, 'hello.txt'), 'Hello from test');
    await writeFile(join(workspaceDir, 'readme.md'), 'Test readme file');

    // Set up handlers
    mockServer.onTymbalFrame = (tid, frame) => {
      if (tid === threadId) {
        receivedFrames.push(frame);
      }
    };

    mockServer.onContainerStatus = (tid, status) => {
      if (tid === threadId) {
        statusUpdates.push(status);
      }
    };

    const errorPromise = new Promise<Error | null>((resolve) => {
      mockServer.onError = (error) => {
        if (error.threadId === threadId) {
          resolve(new Error(error.message));
        }
      };

      // Timeout after waiting for frames
      setTimeout(() => resolve(null), 30000);
    });

    // Send message through mock server
    console.log('Sending message to provision container...');
    mockServer.sendMessage(threadId, 'List the files', {
      image: MOCK_AGENT_IMAGE,
    });

    // Wait for frames or error
    const error = await errorPromise;
    if (error) {
      throw error;
    }

    // Verify we got container status updates
    console.log('Status updates:', statusUpdates);
    expect(statusUpdates).toContain('starting');
    expect(statusUpdates).toContain('running');

    // Verify we received tymbal frames
    console.log('Received frames:', receivedFrames.length);
    expect(receivedFrames.length).toBeGreaterThan(0);

    // Check frame content
    const allText = receivedFrames
      .map((f) => {
        try {
          const parsed = JSON.parse(f);
          return parsed.a ?? '';
        } catch {
          return '';
        }
      })
      .join('');

    console.log('Combined output:', allText);

    // Should contain file listings from /workspace
    expect(allText).toContain('Listing files');
    // The mock agent creates hello.txt and readme.md in the image
    expect(allText).toMatch(/hello\.txt|readme\.md/);

    // Stop the thread
    mockServer.stopThread(threadId);

    // Wait for stop
    await new Promise((r) => setTimeout(r, 2000));

    expect(statusUpdates).toContain('stopping');
  }, TEST_TIMEOUT);

  it('should handle multiple messages to same container', async () => {
    const threadId = 'e2e-multi:agent';
    const framesByRequest: string[][] = [[], []];
    let currentRequest = 0;

    mockServer.onTymbalFrame = (tid, frame) => {
      if (tid === threadId) {
        framesByRequest[currentRequest].push(frame);
      }
    };

    // First message - provisions container
    console.log('First message...');
    mockServer.sendMessage(threadId, 'First request', {
      image: MOCK_AGENT_IMAGE,
    });

    // Wait for response
    await new Promise((r) => setTimeout(r, 5000));
    currentRequest = 1;

    // Second message - reuses container
    console.log('Second message...');
    mockServer.sendMessage(threadId, 'Second request', {
      image: MOCK_AGENT_IMAGE,
    });

    await new Promise((r) => setTimeout(r, 5000));

    // Both requests should have received frames
    expect(framesByRequest[0].length).toBeGreaterThan(0);
    expect(framesByRequest[1].length).toBeGreaterThan(0);

    // Cleanup
    mockServer.stopThread(threadId);
    await new Promise((r) => setTimeout(r, 2000));
  }, TEST_TIMEOUT);
});
