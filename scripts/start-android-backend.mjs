// Opt in to the packaged client origin without modifying local .env credentials.
process.env.ANDROID_CLIENT_ORIGIN = "https://localhost";
await import("../dist/server.js");
