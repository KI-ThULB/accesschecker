import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import Ajv from 'ajv';
import type { ScanConfig } from './types.js';

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
    .option('--url <url>')
    .option('--no-images')
    .option('--no-skiplinks')
    .option('--no-meta-doc');
  program.parse(argv, { from: 'user' });
  const opts = program.opts();

    const config: ScanConfig = { ...defaults } as any;
    if (opts.profile) config.profile = opts.profile;
  const modulesOverridden = !!opts.modules;
  if (opts.modules) {
    const mods: Record<string, boolean> = {};
    for (const m of String(opts.modules).split(',')) mods[m.trim()] = true;
    config.modules = mods;
  }
  if (opts.url) config.url = opts.url;
  if (opts.images === false) config.modules = { ...config.modules, images: false };
  if (opts.skiplinks === false) config.modules = { ...config.modules, skiplinks: false };
  if (opts.metaDoc === false) config.modules = { ...config.modules, 'meta-doc': false };

  // env overrides (e.g., PROFILE, MODULES)
  if (process.env.PROFILE) config.profile = process.env.PROFILE;
    if (process.env.MODULES) {
      const mods: Record<string, boolean> = {};
      for (const m of process.env.MODULES.split(',')) mods[m.trim()] = true;
      config.modules = mods;
    }

    try {
      const profPath = path.join(process.cwd(), 'profiles', `${config.profile}.json`);
      const profCfg = JSON.parse(await fs.readFile(profPath, 'utf-8'));
      if (profCfg.modules && !modulesOverridden) config.modules = { ...config.modules, ...profCfg.modules };
      for (const k of Object.keys(profCfg)) {
        if (k === 'modules') continue;
        (config as any)[k] = profCfg[k];
      }
    } catch {}

    return config;
  }
