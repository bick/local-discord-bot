import type { Message } from "discord.js";
import { logger } from "../logger.js";
import { askBigTex } from "./brain.js";

/** Big Tex is the 55-foot cowboy at the State Fair of Texas. He talks like it. */
export const GREETINGS: readonly string[] = [
  "Howdy, partner! You'll have to speak up, I'm 55 feet tall and the wind's blowin'.",
  "Well hey there! Pull up a hay bale. Not that one, that's my lunch.",
  "Howdy! I'd tip my hat, but it's a 75-gallon hat and somebody'd lose an eye.",
  "Hi yourself! You just made a giant's day. A literal giant. Me.",
  "Howdy, friend! I wear size 96 boots, so watch where you're standin'.",
  "Well butter my corny dog, a visitor!",
  "Hey there! I've been standin' in this same spot since 1952, so company's always welcome.",
  "Howdy! Fair warning: I only know three things. Events, corny dogs, and how to stand very still.",
  "Hi! I'd shake your hand, but it'd be more of a full-body experience for you.",
  "Howdy, y'all! Yes, even if it's just one of you. Especially then.",
  "Well hey! You're lookin' sharp today. From up here everybody looks like a nice little ant, but still.",
  "Hello there! I'm the tallest cowboy in Texas and the shortest-winded. What do you need?",
  "Howdy! I'd invite you over, but my place is a parking lot at Fair Park eleven months a year.",
  "Hey hey! You rang? I can hear you all the way up here, by the way. Acoustics are great.",
  "Howdy, neighbor! Got any plans this weekend, or do I need to go find you some?",
  "Hi! Don't mind the creakin', that's just my knees. They're 70-some years old and mostly steel.",
  "Well howdy! You're the best thing to happen to me since the Fletcher's line got shorter.",
  "Hey there, sugar! I'm not supposed to have favorites, but between us, it's you.",
  "Howdy! I've seen 70 State Fairs and you're still the most interesting thing I've seen today.",
  "Hi! I'm what happens when a Santa Claus statue gets a Texas makeover. Long story. Ask me sometime.",
  "Howdy, partner! Saddle up, there's always somethin' goin' on in DFW.",
  "Well hello! If you hear a booming voice, that's me. If you smell funnel cake, that's also me, spiritually.",
  "Hey! You just said hi to a 55-foot cowboy. Put that on your résumé.",
  "Howdy! I'd come down there, but they bolted me in after the last time I tried.",
  "Hi there! Bless your heart for sayin' hello. No, the nice kind of bless your heart.",
  "Howdy! Fun fact: my jeans are custom. Off the rack just doesn't come in 'building'.",
  "Well hey, friend! I'm all ears. Big ears. Proportionally sized ears.",
  "Hello! I came back from a fire in 2012 bigger and better. You can too. Anyway, what's up?",
  "Howdy! You caught me between waves. Folks wave at me all day. My arm's been up since October.",
  "Hey there! Remember: everything's bigger in Texas, including my 'hello'. HELLO!",
  "Howdy, partner! I'm legally required to say 'Howdy, folks!' at least once an hour. Howdy, folks!",
  "Hi! I'd offer you a seat, but I've been standin' for seven decades and I don't know where they keep 'em.",
  "Well howdy do! You look like somebody who's about to go to an event. Want me to find you one?",
  "Hey hey hey! A real live human talkin' to me. Usually it's just pigeons.",
  "Howdy! I'm the friendliest giant in Dallas. Okay, the only giant. Friendliest anyway.",
  "Hi there! You know, from up here, I-30 traffic looks almost peaceful. Almost.",
  "Howdy! I keep my boots clean, my hat big, and my calendar full. Need a calendar filled?",
  "Well hello there! Try `/weekend` and I'll tell you where all the good stuff is.",
  "Hey, partner! If you're bored, that's on you. DFW's got more goin' on than a rodeo clown's schedule.",
  "Howdy! I've got a voice like thunder and a heart like a chicken-fried steak. Big and warm.",
  "Hi! Sorry, the sun was in my eyes. It's always in my eyes. I'm very tall.",
  "Howdy, friend! You say hi to every giant cowboy, or am I special?",
  "Well hey! Glad you stopped by. Mind the cattle, they've got the right of way.",
  "Howdy! I'm like a lighthouse, but for people lookin' for funnel cake.",
  "Hey there! You just made my boots shuffle. Don't worry, nobody got stepped on. This time.",
  "Howdy! I'd give you a hug, but my last hug was technically a structural incident.",
  "Hi, darlin'! Grab your boots and your best friends, there's fun to be had.",
  "Howdy, partner! Ask me what's goin' on with `/events`. I don't bite. I can't, actually, my jaw's on a motor.",
  "Well howdy! I've been told I'm a lot. Fifty-five feet of a lot.",
  "Hey there! Tell your friends Big Tex said hi. Tell 'em loud, I like it loud.",
];

let lastIndex = -1;
/** A random greeting that isn't the same as the last one. */
export function pickGreeting(random: () => number = Math.random): string {
  let i = Math.floor(random() * GREETINGS.length);
  if (i === lastIndex) i = (i + 1) % GREETINGS.length;
  lastIndex = i;
  return GREETINGS[i]!;
}

/** Per-user cooldown so nobody turns Big Tex into a slot machine. */
const COOLDOWN_MS = 10_000;
const lastReplyAt = new Map<string, number>();

/** True when the message is aimed at the bot: a DM, an @mention (including reply pings), or an @ of its role. */
export function isAddressedToBot(message: Message): boolean {
  if (!message.inGuild()) return true;
  if (message.mentions.users.has(message.client.user.id)) return true;
  const botRole = message.guild.members.me?.roles.botRole;
  return botRole != null && message.mentions.roles.has(botRole.id);
}

// A hello plus at most three more words ("hey there neighbor", "good morning big tex"). Longer messages are conversation.
const BARE_GREETING = /^(hi+|hey+|hello+|howdy|yo+|sup|hiya|heya|greetings|good (morning|afternoon|evening))\b[\s,.!]*([\w']+[\s,.!]*){0,3}$/i;

/** True when the text (mentions already stripped) is just a hello, like "hey there neighbor". */
export function isBareGreeting(text: string): boolean {
  return text === "" || BARE_GREETING.test(text);
}

/** Message text with user/role mentions removed and whitespace collapsed. */
export function stripMentions(content: string): string {
  return content.replace(/<@[!&]?\d+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The bot message being replied to, if any, so Big Tex can follow the thread. */
async function repliedBotText(message: Message): Promise<string | undefined> {
  if (!message.reference?.messageId) return undefined;
  const ref = await message.fetchReference().catch(() => null);
  return ref?.author.id === message.client.user.id ? ref.content : undefined;
}

/** Answer anyone who @s Big Tex (or DMs him): canned hellos for greetings, Claude for everything else. */
export async function handleGreeting(message: Message): Promise<void> {
  if (message.author.bot || message.system || !isAddressedToBot(message)) return;

  const now = Date.now();
  if (now - (lastReplyAt.get(message.author.id) ?? 0) < COOLDOWN_MS) return;
  lastReplyAt.set(message.author.id, now);

  const text = stripMentions(message.content);
  let content: string | null = null;
  if (!isBareGreeting(text)) {
    if (message.channel.isSendable()) await message.channel.sendTyping().catch(() => undefined);
    content = await askBigTex(text, {
      guildId: message.guildId,
      askedBy: message.member?.displayName ?? message.author.displayName,
      replyingTo: await repliedBotText(message),
    });
  }
  content ??= pickGreeting();

  // Never let a generated reply ping anyone.
  const allowedMentions = { parse: [], repliedUser: false };
  try {
    await message.reply({ content, allowedMentions });
  } catch (err) {
    // Replies need Read Message History; fall back to a plain message.
    logger.debug({ err }, "reply failed; sending plainly");
    if (message.channel.isSendable()) await message.channel.send({ content, allowedMentions }).catch(() => undefined);
  }
}
