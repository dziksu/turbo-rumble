import { createGameServer } from './app.ts';
import { loadConfig } from './config.ts';
import { networkInfo } from './http.ts';

const config = loadConfig();
const server = await createGameServer(config);
try {
  await server.listen();
  const info = networkInfo(config);
  console.log(
    `\n  TURBO RUMBLE\n  Local: ${info.localUrl}\n${info.networkUrls.map((url) => `  Phone: ${url}`).join('\n')}\n`,
  );
} catch (error) {
  await server.close();
  throw error;
}
function shutdown() {
  const deadline = setTimeout(() => {
    console.error('Shutdown exceeded 15 seconds');
    process.exit(1);
  }, 15_000).unref();
  void server
    .close()
    .then(() => clearTimeout(deadline))
    .catch((error: unknown) => {
      clearTimeout(deadline);
      console.error('Shutdown failed', error);
      process.exitCode = 1;
    });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
