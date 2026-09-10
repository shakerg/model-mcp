import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const image = process.env.MODEL_MCP_DOCKER_IMAGE;
assert(image, 'MODEL_MCP_DOCKER_IMAGE is required');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const transport = new StdioClientTransport({
  command: 'docker',
  args: [
    'run',
    '--rm',
    '-i',
    '--add-host',
    'host.docker.internal:host-gateway',
    image
  ],
  stderr: 'pipe'
});
const client = new Client({ name: 'model-mcp-docker-smoke-test', version: packageJson.version });
let timeout;

try {
  await Promise.race([
    client.connect(transport),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Docker MCP initialization timed out')), 30_000);
    })
  ]);
  clearTimeout(timeout);

  const { tools } = await client.listTools();
  assert(tools.some((tool) => tool.name === 'list_local_models'), 'Docker server did not expose list_local_models');
  console.log(`Initialized ${image} over stdio and discovered ${tools.length} tools.`);
} finally {
  clearTimeout(timeout);
  await client.close();
}
