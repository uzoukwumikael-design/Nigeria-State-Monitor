import { randomBytes } from "node:crypto";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

console.log(`Random secrets for Nigeria State Monitor. Copy each into your hosting settings (for example Vercel →
Project → Settings → Environment Variables). They are shown once and not stored anywhere.

CRON_SECRET=${hex(24)}

Optional (only if you use the /review console, which automatic publishing does not need):
REVIEWER_SESSION_SECRET=${hex(32)}
`);
