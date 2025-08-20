import { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'forms',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'forms', version: '0.1.0', findings: [] };
  }
};

export default mod;
