import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'model-mcp-package-'));

async function withTimeout(promise, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 10_000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', temporaryDirectory],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const [packResult] = JSON.parse(packOutput);
  const packedFiles = new Set(packResult.files.map((file) => file.path));

  assert(packedFiles.has('dist/index.js'), 'npm package does not contain dist/index.js');
  assert(packedFiles.has('server.json'), 'npm package does not contain server.json');

  const tarball = path.join(temporaryDirectory, packResult.filename);
  const installDirectory = path.join(temporaryDirectory, 'install');
  await writeFile(
    path.join(temporaryDirectory, 'package.json'),
    JSON.stringify({ private: true }, null, 2)
  );
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', installDirectory, tarball],
    { cwd: temporaryDirectory, stdio: 'inherit' }
  );

  const packageDirectory = path.join(installDirectory, 'node_modules', 'model-mcp');
  const packageJson = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
  const serverJson = JSON.parse(await readFile(path.join(packageDirectory, 'server.json'), 'utf8'));
  const binary = path.join(packageDirectory, 'dist', 'index.js');
  const npmPackage = serverJson.packages.find((entry) => entry.registryType === 'npm');
  const containerPackage = serverJson.packages.find((entry) => entry.registryType === 'oci');

  assert.equal(packageJson.bin['model-mcp'], 'dist/index.js', 'installed package has an incorrect model-mcp bin target');
  assert.equal(packageJson.mcpName, serverJson.name, 'package mcpName differs from server.json name');
  assert(npmPackage, 'server.json does not declare an npm package');
  assert(containerPackage, 'server.json does not declare an OCI package');
  assert.equal(npmPackage.identifier, packageJson.name, 'server.json npm identifier differs from package name');
  assert.equal(npmPackage.version, packageJson.version, 'server.json package version differs from package version');
  assert.equal(containerPackage.version, packageJson.version, 'server.json container version differs from package version');
  assert(containerPackage.identifier.endsWith(`:${packageJson.version}`), 'container tag differs from package version');
  assert.equal(serverJson.version, packageJson.version, 'server.json server version differs from package version');
  await access(binary, constants.R_OK);
  assert((await readFile(binary, 'utf8')).startsWith('#!/usr/bin/env node\n'), 'dist binary is missing its Node.js shebang');

  if (process.platform !== 'win32') {
    const mode = (await stat(binary)).mode;
    assert((mode & 0o111) !== 0, 'dist binary is not executable');
  }

  const installedCommand = process.platform === 'win32'
    ? path.join(installDirectory, 'node_modules', '.bin', 'model-mcp.cmd')
    : path.join(installDirectory, 'node_modules', '.bin', 'model-mcp');
  await access(installedCommand, constants.X_OK);

  const transport = new StdioClientTransport({
    command: installedCommand,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'model-mcp-package-smoke-test', version: packageJson.version });

  try {
    await withTimeout(client.connect(transport), 'packed server did not complete MCP initialization within 10 seconds');
    const tools = await withTimeout(client.listTools(), 'packed server did not list tools within 10 seconds');
    assert(tools.tools.some((tool) => tool.name === 'list_local_models'), 'packed server did not expose list_local_models');
  } finally {
    await client.close();
  }

  console.log(`Packed ${packResult.filename}, installed it cleanly, and initialized its stdio server.`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
