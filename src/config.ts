export interface BuddyConfig {
  enabled: boolean;
  replaceText: boolean;
  typewriter: boolean;
  mode: 'avatar' | 'emoji';
  size: number;
  emojis: string[];
}

export const defaults: BuddyConfig = {
  enabled: true,
  replaceText: true,
  typewriter: true,
  mode: 'avatar',
  size: 18,
  emojis: ['🤿', '🫧', '🌊', '🐙', '🔍', '🧠', '💭'],
};
