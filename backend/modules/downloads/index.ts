import { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'downloads',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'downloads', version: '0.1.0', findings: [] };
  }
};

export default mod;
