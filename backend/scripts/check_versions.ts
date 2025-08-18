import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Load environment variables from a .env file if present
loadEnv();

async function main() {
  // Simple sanity check to ensure the running Node version matches package.json
  const pkg = JSON.parse(await readFile(resolve('./package.json'), 'utf8')) as any;
  const required: string | undefined = pkg?.engines?.node;
  if (required && !process.version.startsWith(required.replace('^', ''))) {
    console.error(`Expected node version ${required}, but running ${process.version}`);
    process.exit(1);
  }
  console.log('Environment and versions look good.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
