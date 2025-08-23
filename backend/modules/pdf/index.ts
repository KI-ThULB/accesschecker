import type { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'pdf',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'pdf', version: '0.1.0', findings: [] };
  }
};

export default mod;
