import 'dotenv/config';
import { loadConfig } from './lib/config.js';
import { buildApp } from './app.js';

const config = loadConfig();

const logger =
  process.env.NODE_ENV === 'production' ? true : { transport: { target: 'pino-pretty' } };

const { app, scheduler } = await buildApp({ config, logger });

await scheduler.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    scheduler.stop();
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
