import { promises as fs } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import type { OmbudsConfig, OmbudsEntry } from '../../types/ombuds.js';

let cached: OmbudsConfig | null = null;

export async function loadOmbudsConfig(filePath: string = path.join(process.cwd(), 'config', 'ombudspersons.json')): Promise<OmbudsConfig> {
  const schemaPath = path.join(process.cwd(), 'config', 'schemas', 'ombudspersons.schema.json');
  const [dataRaw, schemaRaw] = await Promise.all([
    fs.readFile(filePath, 'utf-8'),
    fs.readFile(schemaPath, 'utf-8')
  ]);
  const data: OmbudsConfig = JSON.parse(dataRaw);
  const schema = JSON.parse(schemaRaw);
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile<OmbudsConfig>(schema);
  if (!validate(data)) {
    throw new Error('Invalid ombudspersons config: ' + ajv.errorsText(validate.errors));
  }
  cached = data;
  return data;
}

export function resolveJurisdiction(opts: { configOverride?: string; fromDomain?: string }): string {
  if (opts.configOverride) return opts.configOverride;
  if (!cached) throw new Error('Config not loaded');
  // Domain heuristik könnte hier ergänzt werden
  return cached.defaultJurisdiction;
}

export function getEntry(jurisdiction: string): OmbudsEntry {
  if (!cached) throw new Error('Config not loaded');
  return (
    cached.entries.find(e => e.jurisdiction === jurisdiction) ||
    cached.entries.find(e => e.jurisdiction === cached!.defaultJurisdiction)!
  );
}
