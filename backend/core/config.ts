import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import Ajv from 'ajv';
import { ScanConfig } from './types.js';

export async function loadConfig(argv: string[] = process.argv.slice(2)): Promise<ScanConfig> {
  const configDir = path.join(process.cwd(), 'config');
  const defaultsPath = path.join(configDir, 'scan.defaults.json');
  const schemaPath = path.join(configDir, 'schemas', 'scan.defaults.schema.json');
  const defaults: ScanConfig = JSON.parse(await fs.readFile(defaultsPath, 'utf-8'));
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (!validate(defaults)) {
    throw new Error('Invalid defaults config');
  }
  const program = new Command();
  program
    .allowUnknownOption(true)
    .option('--profile <profile>')
    .option('--modules <modules>')
    .option('--url <url>');
  program.parse(argv, { from: 'user' });
  const opts = program.opts();

  const config: ScanConfig = { ...defaults };
  if (opts.profile) config.profile = opts.profile;
  if (opts.modules) {
    const mods: Record<string, boolean> = {};
    for (const m of String(opts.modules).split(',')) mods[m.trim()] = true;
    config.modules = mods;
  }
  if (opts.url) config.url = opts.url;

  // env overrides (e.g., PROFILE, MODULES)
  if (process.env.PROFILE) config.profile = process.env.PROFILE;
  if (process.env.MODULES) {
    const mods: Record<string, boolean> = {};
    for (const m of process.env.MODULES.split(',')) mods[m.trim()] = true;
    config.modules = mods;
  }
  return config;
}
