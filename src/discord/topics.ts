/** Conversation starters for /topic. Hand-written so they're free, instant, and work without an API key. */
export const TOPICS = {
  "would-you-rather": [
    "Would you rather be able to talk to animals or speak every human language?",
    "Would you rather have a rewind button or a pause button for your life?",
    "Would you rather fight one horse-sized duck or a hundred duck-sized horses?",
    "Would you rather always be 10 minutes late or always be 20 minutes early?",
    "Would you rather never have to sleep or never have to eat?",
    "Would you rather live without music or without movies and TV?",
    "Would you rather have a personal chef or a personal driver?",
    "Would you rather know how you die or when you die?",
    "Would you rather be famous for something embarrassing or unknown for something amazing?",
    "Would you rather only be able to whisper or only be able to shout?",
    "Would you rather explore deep space or the deep ocean?",
    "Would you rather have unlimited free flights or unlimited free food at any restaurant?",
    "Would you rather have a dragon or be a dragon?",
    "Would you rather relive the same great day forever or skip ahead 10 years?",
    "Would you rather give up coffee forever or give up cheese forever?",
  ],
  "hot-take": [
    "What's a food everyone loves that you think is overrated?",
    "What's the most overrated movie of all time?",
    "Is a hot dog a sandwich? Defend your answer.",
    "Pineapple on pizza: crime or genius?",
    "What's a hill you're willing to die on that nobody else cares about?",
    "Which popular song do you secretly can't stand?",
    "What's the worst sport to watch on TV?",
    "Cereal before milk or milk before cereal, and why is the other way wrong?",
    "What's a 'normal' thing that you think is actually kind of weird?",
    "What's the most useless invention that people still buy?",
    "Is it ever okay to recline your seat on a plane?",
    "What's the best decade for music, and you can only pick one?",
    "Which fast food chain is the most overrated?",
    "Socks with sandals: fashion statement or cry for help?",
    "What's an unpopular opinion you have about holidays?",
  ],
  hypothetical: [
    "You get one superpower, but it only works on Tuesdays. What do you pick?",
    "You can add one new holiday to the calendar. What is it and how do we celebrate?",
    "A movie is being made about your life. Who plays you, and what's the title?",
    "You wake up as a cat for a day. What's the first thing you do?",
    "You can instantly master one skill. What are you picking?",
    "You get to rename every month. What's March called now?",
    "You can have dinner with any three people, living or dead. Who's at the table?",
    "Zombie apocalypse starts tomorrow. What's your weapon and where are you hiding?",
    "You win the lottery, but you have to spend it all in 24 hours. Go.",
    "You can teleport, but only to places you've already been. Where do you go first?",
    "You're given a talk show. What's it called and who's your first guest?",
    "You can bring back one discontinued food or snack. What is it?",
    "You can only eat one cuisine for the rest of your life. Which one?",
    "Aliens land and ask you to explain one thing about humans. What do you pick?",
    "You can make one law that everyone has to follow. What is it?",
  ],
  nostalgia: [
    "What's a TV show from your childhood that still holds up?",
    "What was your favorite toy growing up?",
    "What's a snack you loved as a kid that you'd still eat today?",
    "What was the first concert you ever went to?",
    "What video game did you sink the most hours into as a kid?",
    "What's a trend from your school days that you're glad is gone?",
    "What's the first album or song you remember buying?",
    "What did you want to be when you grew up?",
    "What's the best birthday party you ever had?",
    "What's a smell that instantly takes you back to childhood?",
    "What's a movie you watched way too many times as a kid?",
    "What's the dumbest thing you ever got in trouble for?",
    "What's a piece of old tech you miss?",
    "What was your go-to order at your favorite restaurant growing up?",
    "What's a family tradition you still keep?",
  ],
  "get-to-know-you": [
    "What's the best thing you've eaten this month?",
    "What's something you're weirdly good at?",
    "What's your go-to karaoke song?",
    "What's the best trip you've ever taken?",
    "What's a hobby you've always wanted to try but haven't yet?",
    "What's your comfort movie or show?",
    "What's the last thing that made you laugh out loud?",
    "What's your most-used emoji, and what does that say about you?",
    "What's a small thing that instantly makes your day better?",
    "What's the best piece of advice you've ever gotten?",
    "If you had a theme song, what would it be?",
    "What's something on your bucket list?",
    "Morning person or night owl? Prove it.",
    "What's the most random fact you know?",
    "What's a skill you picked up recently?",
  ],
} as const satisfies Record<string, readonly string[]>;

export type TopicCategory = keyof typeof TOPICS;
export const TOPIC_CATEGORIES = Object.keys(TOPICS) as TopicCategory[];

export const CATEGORY_LABELS: Record<TopicCategory, string> = {
  "would-you-rather": "🤔 Would you rather",
  "hot-take": "🌶️ Hot take",
  hypothetical: "🛸 Hypothetical",
  nostalgia: "📼 Nostalgia",
  "get-to-know-you": "👋 Get to know you",
};

/** Topics still unused per category; each category is a shuffled bag so nothing repeats until all have been used. */
const bags = new Map<TopicCategory, string[]>();

/** Pick a topic, from a category if given, otherwise from a random one. */
export function pickTopic(category?: TopicCategory, random: () => number = Math.random): { category: TopicCategory; topic: string } {
  const cat = category ?? TOPIC_CATEGORIES[Math.floor(random() * TOPIC_CATEGORIES.length)]!;
  let bag = bags.get(cat);
  if (!bag?.length) {
    bag = [...TOPICS[cat]];
    bags.set(cat, bag);
  }
  const [topic] = bag.splice(Math.floor(random() * bag.length), 1);
  return { category: cat, topic: topic! };
}
