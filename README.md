# model-mcp

`model-mcp` is a Model Context Protocol (MCP) server that discovers local model runtimes and exposes their endpoint metadata to MCP clients such as Copilot.

It checks common localhost endpoints for:

- Ollama (`http://127.0.0.1:11434/api/tags`)
- LM Studio (`http://127.0.0.1:1234/v1/models`)
- LocalAI or OpenAI-compatible local servers (`http://127.0.0.1:8080/v1/models`)

The server does not proxy prompts or model completions. It advertises where local models are available so an MCP-aware client can inspect and use that configuration.

## Install

### Run from a source checkout

```sh
git clone https://github.com/shakerg/model-mcp.git
cd model-mcp
npm install
npm run build
```

In the GitHub Copilot app, add a **local/stdio** MCP server. Use the absolute path to the checkout:

```json
{
  "servers": {
    "local-models": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/model-mcp/dist/index.js"]
    }
  }
}
```

You can also run the checkout directly with `npm start`; it communicates over stdio and normally waits silently for an MCP client.

### Install from npm

If `npm view model-mcp version` returns the release you want, add a **local/stdio** MCP server in the GitHub Copilot app and let `npx` download and launch it:

```json
{
  "servers": {
    "local-models": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "model-mcp@<published-version>"]
    }
  }
}
```

Use the package's exact published version for reproducible installation.

### Install from an MCP registry

After a release is listed in an MCP registry, supported Copilot clients can install it from the registry instead of entering the command manually. The installer reads `server.json` and presents these optional environment fields:

- `MODEL_MCP_ENDPOINTS`
- `MODEL_MCP_TIMEOUT_MS`
- `MODEL_MCP_ALLOW_REMOTE`

Leave a field unset to use its default. Registry installation is available only after the matching npm package version and `server.json` entry have both been published.

> [!WARNING]
> `https://github.com/shakerg/model-mcp` is a repository page, not a remote MCP endpoint. Do not enter it as an HTTP, SSE, or streamable HTTP server URL. This project is a local stdio server; treating the GitHub URL as an MCP endpoint sends protocol requests to a web page and results in HTTP errors such as `422` with an HTML response.

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
npm run test:package
```

`test:package` type-checks the source, validates `server.json` against its official MCP schema, creates the npm tarball, checks that `dist/index.js` is executable and included, installs the tarball into a clean temporary project, and completes an MCP initialize/list-tools exchange over stdio.

## Publishing checklist

Publication requires maintainer access to npm and the MCP registry:

1. Run `npm run test:package`.
2. Confirm the version matches in `package.json`, `server.json`, and `src/index.ts`, and that `package.json#mcpName` matches `server.json#name`.
3. Publish with the project owner's npm account or configured trusted publishing.
4. Confirm `npm view model-mcp version` returns the released version.
5. Only then publish `server.json` to an MCP registry.
