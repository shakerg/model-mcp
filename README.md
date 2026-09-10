# model-mcp

`model-mcp` is a Model Context Protocol (MCP) server that discovers local model runtimes and exposes their endpoint metadata to MCP clients such as Copilot.

It checks common localhost endpoints for:

- Ollama (`http://127.0.0.1:11434/api/tags`)
- LM Studio (`http://127.0.0.1:1234/v1/models`)
- LocalAI or OpenAI-compatible local servers (`http://127.0.0.1:8080/v1/models`)

The server does not proxy prompts or model completions. It advertises where local models are available so an MCP-aware client can inspect and use that configuration.

## Install

```sh
npm install
npm run build
```

## Run

```sh
npm start
```

For MCP clients, run the compiled server over stdio:

```json
{
  "mcpServers": {
    "local-models": {
      "command": "npx",
      "args": ["-y", "model-mcp"]
    }
  }
}
```

During local development, point the command at this checkout after building:

```json
{
  "mcpServers": {
    "local-models": {
      "command": "node",
      "args": ["/absolute/path/to/model-mcp/dist/index.js"]
    }
  }
}
```

## Configuration

Set `MODEL_MCP_ENDPOINTS` to a comma-separated list of local endpoint base URLs when your model servers use different ports.

```sh
MODEL_MCP_ENDPOINTS="http://127.0.0.1:11434,http://127.0.0.1:1234" npm start
```

By default, only loopback hosts are accepted. Set `MODEL_MCP_ALLOW_REMOTE=true` only when you intentionally want to expose non-local model endpoints through the MCP server.

Optional environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `MODEL_MCP_ENDPOINTS` | Common Ollama, LM Studio, and LocalAI localhost URLs | Comma-separated endpoint base URLs. |
| `MODEL_MCP_TIMEOUT_MS` | `2000` | Timeout for each endpoint discovery request. |
| `MODEL_MCP_ALLOW_REMOTE` | `false` | Allows non-loopback endpoints when set to `true`. |

## MCP capabilities

### Tools

- `list_local_models` - returns configured endpoints, reachability, and discovered model IDs.
- `describe_model_endpoint` - inspects one endpoint by ID, such as `ollama` or `lm-studio`.
- `get_model_endpoint_config` - returns an MCP configuration snippet that can be used by Copilot or another MCP client.

### Resources

- `local-models://endpoints` - JSON description of discovered endpoints and models.
- `local-models://copilot-config` - JSON MCP configuration example for launching this server.

## Development

```sh
npm run check
npm run build
```
