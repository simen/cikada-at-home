import type {
  CloudToProviderMessage,
  ProviderToCloudMessage,
  SendMessageCommand,
  StopThreadCommand,
  GetStatusCommand,
} from '../types.js';
import type { DockerOrchestrator } from '../orchestrator/docker-orchestrator.js';

export class MessageRouter {
  private orchestrator: DockerOrchestrator;
  private sender: ((msg: ProviderToCloudMessage) => void) | null = null;

  constructor(orchestrator: DockerOrchestrator) {
    this.orchestrator = orchestrator;
  }

  setSender(sender: (msg: ProviderToCloudMessage) => void): void {
    this.sender = sender;
  }

  handleMessage(message: CloudToProviderMessage): void {
    switch (message.type) {
      case 'welcome':
        console.log('Received welcome from cloud');
        break;

      case 'ready':
        console.log(`Provider registered as "${message.displayName}" (${message.providerId})`);
        break;

      case 'sendMessage':
        this.handleSendMessage(message);
        break;

      case 'stopThread':
        this.handleStopThread(message);
        break;

      case 'getStatus':
        this.handleGetStatus(message);
        break;

      case 'disconnect':
        console.log(`Cloud requested disconnect: ${message.reason}`);
        break;

      default:
        console.warn('Unknown message type:', (message as { type: string }).type);
    }
  }

  private async handleSendMessage(cmd: SendMessageCommand): Promise<void> {
    const { requestId, threadId, content, image, mcpServers, systemPrompt } = cmd;

    try {
      // Notify that container is starting
      this.send({
        type: 'containerStatus',
        threadId,
        status: 'starting',
      });

      // Send message to container (starts if needed)
      await this.orchestrator.sendMessage(threadId, content, {
        image,
        mcpServers,
        systemPrompt,
        onTymbalFrame: (frame) => {
          this.send({
            type: 'tymbal',
            threadId,
            frame,
          });
        },
      });

      // Update status to running
      const status = await this.orchestrator.getStatus(threadId);
      this.send({
        type: 'containerStatus',
        threadId,
        status: 'running',
        containerId: status?.containerId,
      });
    } catch (error) {
      this.send({
        type: 'error',
        threadId,
        code: 'SEND_MESSAGE_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleStopThread(cmd: StopThreadCommand): Promise<void> {
    const { requestId, threadId, reason } = cmd;

    try {
      this.send({
        type: 'containerStatus',
        threadId,
        status: 'stopping',
      });

      await this.orchestrator.stopThread(threadId, reason);

      this.send({
        type: 'containerStatus',
        threadId,
        status: 'stopped',
      });
    } catch (error) {
      this.send({
        type: 'error',
        threadId,
        code: 'STOP_THREAD_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleGetStatus(cmd: GetStatusCommand): Promise<void> {
    const { requestId, threadId } = cmd;

    try {
      const status = await this.orchestrator.getStatus(threadId);
      this.send({
        type: 'statusResponse',
        requestId,
        status: status?.state ?? 'unknown',
        containerId: status?.containerId,
      });
    } catch (error) {
      this.send({
        type: 'error',
        threadId,
        code: 'GET_STATUS_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private send(message: ProviderToCloudMessage): void {
    if (this.sender) {
      this.sender(message);
    }
  }
}
