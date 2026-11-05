import 'dotenv/config';
import Fastify from 'fastify';

const app = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? true
    : { transport: { target: 'pino-pretty' } },
});
app.get('/api/v1/health', async () => ({ status: 'ok' }));
await app.listen({
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
});