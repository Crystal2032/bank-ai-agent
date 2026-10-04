import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
if (existsSync(".env"))
  throw new Error("Existing .env preserved. Configure it manually.");
const password = randomBytes(18).toString("base64url");
const secret = randomBytes(32).toString("base64url");
writeFileSync(
  ".env",
  `HOST=127.0.0.1\nPORT=3001\nCLIENT_ORIGIN=http://localhost:5173\nRP_ID=localhost\nCOOKIE_SECURE=false\nDATABASE_PATH=.data/bank.sqlite\nAUTH_SECRET=${secret}\nDEMO_PASSWORD=${password}\nMODEL_BASE_URL=https://api.deepseek.com\nMODEL_ID=deepseek-flash\nMODEL_API_KEY=\nSMS_MODE=file\nSMS_OUTBOX_PATH=.data/sms-outbox.jsonl\n`,
  { flag: "wx", mode: 0o600 },
);
console.log(
  "Created ignored .env with random synthetic credentials. Read DEMO_PASSWORD locally to sign in as alex or jordan. SMS uses a local test outbox; no messages are sent.",
);
