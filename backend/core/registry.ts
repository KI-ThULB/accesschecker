import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Module, ScanConfig } from './types.js';

const registered = new Map<string, Module>();

export function register(mod: Module) {
  registered.set(mod.slug, mod);
}

async function loadModule(slug: string): Promise<Module> {
  if (registered.has(slug)) return registered.get(slug)!;
  const modulesDir = path.join(process.cwd(), 'modules');
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const modPath = pathToFileURL(path.join(modulesDir, slug, `index${ext}`)).href;
  const mod: Module = (await import(modPath)).default;
  register(mod);
  return mod;
}

export async function getModules(enabled: string[] = [], profile: string, config: ScanConfig): Promise<Module[]> {
  let list: string[] = [];
  if (enabled.length === 0) {
    const prof = config.profiles?.[profile];
    if (prof && prof.length) list = prof;
    else {
      list = Object.keys(config.modules).filter((m) => config.modules[m]);
    }
  } else {
    list = enabled;
  }
  if (list.includes('*')) {
    const modulesDir = path.join(process.cwd(), 'modules');
    list = await fs.readdir(modulesDir);
  }
  const mods: Module[] = [];
  for (const slug of list) {
    try {
      mods.push(await loadModule(slug));
    } catch (e) {
      // ignore missing modules
    }
  }
  return mods;
}
