import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bankai.assistant",
  appName: "Bank AI Assistant",
  webDir: "dist",
  server: { hostname: "localhost", androidScheme: "https" },
  android: { allowMixedContent: false, loggingBehavior: "none" },
  plugins: { SystemBars: { insetsHandling: "native" } },
};
export default config;
