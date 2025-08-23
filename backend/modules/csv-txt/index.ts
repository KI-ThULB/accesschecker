import type { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'csv-txt',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'csv-txt', version: '0.1.0', findings: [] };
  }
};

export default mod;
