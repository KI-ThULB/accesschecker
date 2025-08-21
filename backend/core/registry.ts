import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Module, ScanConfig } from './types.js';

const registered = new Map<string, Module>();

export function register(mod: Module) {
  registered.set(mod.slug, mod);
}

async function detectModulesDir(): Promise<string> {
  // Prefer compiled modules when running from dist
  const distDir = path.join(process.cwd(), 'dist', 'modules');
  try {
    const s = await fs.stat(distDir);
    if (s.isDirectory()) return distDir;
  } catch {}
  // Fallback to source modules
  return path.join(process.cwd(), 'modules');
}

async function loadModule(slug: string): Promise<Module> {
  if (registered.has(slug)) return registered.get(slug)!;
  const modulesDir = await detectModulesDir();
  // When running from source via tsx, files are .ts; from dist they are .js
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
    const modulesDir = await detectModulesDir();
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
