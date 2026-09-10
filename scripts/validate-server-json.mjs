import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const manifest = JSON.parse(await readFile(new URL('../server.json', import.meta.url), 'utf8'));
const response = await fetch(manifest.$schema);
assert(response.ok, `Unable to download MCP server schema: HTTP ${response.status}`);

const schema = await response.json();
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(schema);
if (!validate(manifest)) {
  throw new Error(`server.json does not match ${manifest.$schema}:\n${ajv.errorsText(validate.errors, { separator: '\n' })}`);
}

console.log(`server.json matches ${manifest.$schema}`);
