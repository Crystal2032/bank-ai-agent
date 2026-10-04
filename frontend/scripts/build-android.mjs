import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const env = { ...process.env };
env.VITE_API_ORIGIN ||= "http://localhost:3001";
env.VITE_ANDROID_PASSKEY_RP_ID ||= "";
const api = new URL(env.VITE_API_ORIGIN);
if (
  api.username ||
  api.password ||
  api.search ||
  api.hash ||
  api.pathname !== "/"
)
  throw new Error("Configure an API origin without credentials or a path.");
if (
  api.protocol !== "https:" &&
  !(
    api.protocol === "http:" &&
    !release &&
    ["localhost", "127.0.0.1"].includes(api.hostname)
  )
)
  throw new Error(
    "Android requires HTTPS; debug builds may use loopback over adb reverse.",
  );
if (
  env.VITE_ANDROID_PASSKEY_RP_ID &&
  (!/^[a-zA-Z0-9.-]+$/.test(env.VITE_ANDROID_PASSKEY_RP_ID) ||
    ["localhost", "127.0.0.1"].includes(env.VITE_ANDROID_PASSKEY_RP_ID))
)
  throw new Error("Native Passkeys require a verified HTTPS RP domain.");
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) throw new Error(`Build step failed: ${command}`);
}
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) throw new Error("Run this script through pnpm android:build.");
run(process.execPath, [pnpmCli, "build", "--mode", "android"]);
run(process.execPath, [pnpmCli, "exec", "cap", "sync", "android"]);
const java = env.JAVA_HOME
  ? resolve(
      env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
run(
  java,
  [
    "-classpath",
    resolve(root, "android/gradle/wrapper/gradle-wrapper.jar"),
    "org.gradle.wrapper.GradleWrapperMain",
    release ? "assembleRelease" : "assembleDebug",
    "--no-daemon",
  ],
  resolve(root, "android"),
);
const variant = release ? "release" : "debug";
const source = resolve(
  root,
  `android/app/build/outputs/apk/${variant}/app-${variant}${release ? "-unsigned" : ""}.apk`,
);
if (!existsSync(source)) throw new Error("APK output missing.");
const output = resolve(
  root,
  `../artifacts/android/bank-ai-${variant}${release ? "-unsigned" : ""}.apk`,
);
mkdirSync(dirname(output), { recursive: true });
copyFileSync(source, output);
const hash = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, hash + "\n");
console.log(`APK: ${output}\nSHA-256: ${hash}`);
