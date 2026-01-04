// Mock agent server that responds with Tymbal frames
// This simulates a real Claude Code agent in a container

import { createServer } from 'node:http';
import { readdir } from 'node:fs/promises';

const PORT = 8080;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/message') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const { content, threadId } = JSON.parse(body);
    console.log(`Received message for ${threadId}: ${content}`);

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

    // Send Tymbal frames that list files in /workspace
    const frameId = Date.now().toString();

    // Frame 1: Start response
    res.write(JSON.stringify({ i: frameId, t: 'set', v: { role: 'assistant' } }) + '\n');

    // Frame 2: Text content announcing what we're doing
    res.write(JSON.stringify({ i: frameId, a: 'Listing files in workspace:\n\n' }) + '\n');

    // List files and send as frames
    try {
      const files = await readdir('/workspace');
      for (const file of files) {
        res.write(JSON.stringify({ i: frameId, a: `- ${file}\n` }) + '\n');
      }
      res.write(JSON.stringify({ i: frameId, a: '\nDone!' }) + '\n');
    } catch (error) {
      res.write(JSON.stringify({ i: frameId, a: `Error: ${error.message}` }) + '\n');
    }

    // Frame: End
    res.write(JSON.stringify({ i: frameId, t: 'end' }) + '\n');

    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Mock agent listening on port ${PORT}`);
});
