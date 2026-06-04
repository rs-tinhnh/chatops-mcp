// scripts/smoke.ts — manual end-to-end check against the real server. NOT run in CI.
// Usage: MATTERMOST_URL=... MATTERMOST_USERNAME=... MATTERMOST_PASSWORD=... CHANNEL=town-square npm run smoke
import { MattermostClient } from "../src/client.js";
import { Resolver } from "../src/resolver.js";
import { readChannelTool } from "../src/tools/read.js";

async function run() {
  const client = new MattermostClient({
    baseUrl: process.env.MATTERMOST_URL!,
    username: process.env.MATTERMOST_USERNAME!,
    password: process.env.MATTERMOST_PASSWORD!,
  });
  const resolver = new Resolver(client);
  const ctx = { client, resolver };

  const channels = await resolver.getChannels();
  console.log(`Login OK. Bạn đang ở ${channels.length} channel.`);

  const channel = process.env.CHANNEL ?? channels[0]?.name;
  if (!channel) {
    console.log("Không có channel nào để đọc.");
    return;
  }

  const out = await readChannelTool(ctx).handler({ channel, limit: 5 });
  console.log(`\n--- 5 tin gần nhất của '${channel}' ---\n${out}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
