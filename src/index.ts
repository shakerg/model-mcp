#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

const SERVER_VERSION = '1.0.1';
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.MODEL_MCP_TIMEOUT_MS ?? '2000', 10);
const ALLOW_REMOTE = process.env.MODEL_MCP_ALLOW_REMOTE === 'true';

type ProviderKind = 'ollama' | 'openai-compatible' | 'lm-studio' | 'localai' | 'llama-cpp';

type Endpoint = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  modelsPath: string;
  source: 'default' | 'environment';
};

type ModelInfo = {
  id: string;
  endpointId: string;
  endpointName: string;
  provider: ProviderKind;
  baseUrl: string;
  details?: Record<string, unknown>;
};

type EndpointStatus = Endpoint & {
  reachable: boolean;
  models: ModelInfo[];
  error?: string;
};

const defaultEndpoints: Endpoint[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    modelsPath: '/api/tags',
    source: 'default'
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    kind: 'lm-studio',
    baseUrl: 'http://127.0.0.1:1234',
    modelsPath: '/v1/models',
    source: 'default'
  },
  {
    id: 'localai',
    name: 'LocalAI',
    kind: 'localai',
    baseUrl: 'http://127.0.0.1:8080',
    modelsPath: '/v1/models',
    source: 'default'
  }
];

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password) {
    throw new Error('Endpoint URLs must not include credentials');
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.startsWith('127.');
}

function inferEndpoint(rawUrl: string, index: number): Endpoint | undefined {
  const baseUrl = normalizeBaseUrl(rawUrl);
  const lower = baseUrl.toLowerCase();
  const kind: ProviderKind = lower.includes('11434') ? 'ollama' : 'openai-compatible';
  if (!ALLOW_REMOTE && !isLoopbackUrl(baseUrl)) {
    return undefined;
  }

  return {
    id: `env-${index + 1}`,
    name: `Configured endpoint ${index + 1}`,
    kind,
    baseUrl,
    modelsPath: kind === 'ollama' ? '/api/tags' : '/v1/models',
    source: 'environment'
  };
}

function environmentEndpoints(): Endpoint[] {
  return (process.env.MODEL_MCP_ENDPOINTS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((rawUrl, index) => {
      try {
        const endpoint = inferEndpoint(rawUrl, index);
        return endpoint ? [endpoint] : [];
      } catch {
        return [];
      }
    });
}

function configuredEndpoints(): Endpoint[] {
  const fromEnvironment = environmentEndpoints();
  const merged = new Map<string, Endpoint>();
  for (const endpoint of [...defaultEndpoints, ...fromEnvironment]) {
    if (ALLOW_REMOTE || isLoopbackUrl(endpoint.baseUrl)) {
      if (!merged.has(endpoint.baseUrl)) {
        merged.set(endpoint.baseUrl, endpoint);
      }
    }
  }

  return [...merged.values()];
}

function withPath(endpoint: Endpoint): string {
  return `${endpoint.baseUrl}${endpoint.modelsPath}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(REQUEST_TIMEOUT_MS) ? REQUEST_TIMEOUT_MS : 2000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseModels(endpoint: Endpoint, payload: unknown): ModelInfo[] {
  const body = asRecord(payload);
  const rawModels = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : [];

  return rawModels.flatMap((raw): ModelInfo[] => {
    const model = asRecord(raw);
    const id = model.name ?? model.id ?? model.model;
    if (typeof id !== 'string' || id.length === 0) {
      return [];
    }

    return [{
      id,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      provider: endpoint.kind,
      baseUrl: endpoint.baseUrl,
      details: model
    }];
  });
}

async function inspectEndpoint(endpoint: Endpoint): Promise<EndpointStatus> {
  try {
    const payload = await fetchJson(withPath(endpoint));
    return {
      ...endpoint,
      reachable: true,
      models: parseModels(endpoint, payload)
    };
  } catch (error) {
    return {
      ...endpoint,
      reachable: false,
      models: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectAllEndpoints(): Promise<EndpointStatus[]> {
  return Promise.all(configuredEndpoints().map(inspectEndpoint));
}

function jsonText(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
  };
}

function copilotConfiguration() {
  const modelEndpoints = environmentEndpoints().map((endpoint) => endpoint.baseUrl).join(',');
  const env = Object.fromEntries(
    [
      'MODEL_MCP_TIMEOUT_MS',
      'MODEL_MCP_ALLOW_REMOTE'
    ].flatMap((name) => {
      const value = process.env[name];
      return value ? [[name, value]] : [];
    })
  );
  if (modelEndpoints) {
    env.MODEL_MCP_ENDPOINTS = modelEndpoints;
  }

  return {
    servers: {
      'local-models': {
        type: 'stdio',
        command: process.execPath,
        args: [fileURLToPath(import.meta.url)],
        ...(Object.keys(env).length > 0 ? { env } : {})
      }
    },
    notes: [
      'This configuration launches the exact installed or locally built server that generated it.',
      'MODEL_MCP_ENDPOINTS is optional; defaults cover Ollama, LM Studio, and LocalAI on common localhost ports.',
      'Set MODEL_MCP_ALLOW_REMOTE=true only if you intentionally want to advertise non-loopback model endpoints.'
    ]
  };
}

const server = new McpServer({
  name: 'model-mcp',
  version: SERVER_VERSION
});

server.registerResource(
  'local-model-endpoints',
  'local-models://endpoints',
  {
    title: 'Local model endpoints',
    description: 'Reachability and model metadata for configured localhost model runtimes.',
    mimeType: 'application/json'
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(await inspectAllEndpoints(), null, 2)
    }]
  })
);

server.registerResource(
  'copilot-mcp-config',
  'local-models://copilot-config',
  {
    title: 'Copilot MCP configuration',
    description: 'Example MCP client configuration that lets Copilot start this server.',
    mimeType: 'application/json'
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'application/json',
      text: JSON.stringify(copilotConfiguration(), null, 2)
    }]
  })
);

server.registerTool(
  'list_local_models',
  {
    title: 'List local models',
    description: 'Discover models from configured localhost model runtimes such as Ollama, LM Studio, and LocalAI.',
    inputSchema: {}
  },
  async () => {
    const endpoints = await inspectAllEndpoints();
    return jsonText({
      endpoints,
      models: endpoints.flatMap((endpoint) => endpoint.models)
    });
  }
);

server.registerTool(
  'get_model_endpoint_config',
  {
    title: 'Get model endpoint configuration',
    description: 'Return the local MCP and model endpoint configuration to share with Copilot or another MCP client.',
    inputSchema: {}
  },
  async () => jsonText(copilotConfiguration())
);

server.registerTool(
  'describe_model_endpoint',
  {
    title: 'Describe model endpoint',
    description: 'Inspect one configured endpoint by id and report whether it is reachable and which models it exposes.',
    inputSchema: {
      endpointId: z.string().describe('Endpoint id from list_local_models, for example ollama or lm-studio')
    }
  },
  async ({ endpointId }) => {
    const endpoint = configuredEndpoints().find((candidate) => candidate.id === endpointId);
    if (!endpoint) {
      return jsonText({ error: `Unknown endpoint id: ${endpointId}`, knownEndpointIds: configuredEndpoints().map((candidate) => candidate.id) });
    }

    return jsonText(await inspectEndpoint(endpoint));
  }
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
