import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({
  logger: true,
});

/**
 * Plugins
 */
await app.register(cors, {
  // Für den Start: alle Origins erlauben. Später feiner einschränken.
  origin: true,
});

/**
 * Routen
 */
app.get('/health', async () => ({ ok: true }));

/**
 * Start
 */
async function start() {
  try {
    const port = Number(process.env.PORT || 8080);
    const host = '0.0.0.0';
    await app.listen({ port, host });
    app.log.info(`API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

/**
 * Graceful shutdown (optional)
 */
const shutdown = async () => {
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
