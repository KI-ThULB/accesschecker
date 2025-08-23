import type { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'office',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'office', version: '0.1.0', findings: [] };
  }
};

export default mod;
