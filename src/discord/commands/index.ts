import { avatar } from "./avatar.js";
import { events } from "./events.js";
import { feeds } from "./feeds.js";
import { going } from "./going.js";
import { ping } from "./ping.js";
import { populate } from "./populate.js";
import { rolesSetup } from "./roles-setup.js";
import { setup } from "./setup.js";
import type { Command } from "./types.js";
import { weekend } from "./weekend.js";

export const commands: Command[] = [ping, events, weekend, going, setup, populate, rolesSetup, feeds, avatar];
export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
