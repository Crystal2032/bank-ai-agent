import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
const config = loadConfig();
const { app } = await buildApp(config);
await app.listen({ host: config.host, port: config.port });
console.log(
  `Bank AI backend listening on ${config.host}:${config.port}. Banking is simulated; model inference uses the configured API.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
