import { Module } from '../../core/types.js';

const mod: Module = {
  slug: 'dom-aria',
  version: '0.1.0',
  async run(ctx) {
    return { module: 'dom-aria', version: '0.1.0', findings: [] };
  }
};

export default mod;
