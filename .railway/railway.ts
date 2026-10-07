import { defineRailway, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "local-discord-bot";

export default defineRailway(() => {
  const local_discord_bot = service("local-discord-bot", {
    build: "pnpm build",
    start: "pnpm start",
    replicas: 1,
    // builder from CaC: "NIXPACKS"
  });
  return project("big-tex-bot", {
    resources: [local_discord_bot],
  });
});
