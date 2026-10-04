import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Production builds carry a restrictive CSP; the dev server needs inline HMR scripts.
function contentSecurityPolicy(apiOrigin: string): Plugin {
  return {
    name: "bank-content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      const policy = [
        "default-src 'self'",
        `connect-src 'self' ${apiOrigin}`,
        "img-src 'self' data:",
        "style-src 'self'",
        "script-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; ");
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiOrigin = new URL(env.VITE_API_ORIGIN || "http://localhost:3001")
    .origin;
  return {
    plugins: [react(), contentSecurityPolicy(apiOrigin)],
    server: { host: "localhost", port: 5173, strictPort: true },
    preview: { host: "localhost", port: 5173, strictPort: true },
    test: { environment: "node", include: ["tests/**/*.test.ts"] },
  };
});
