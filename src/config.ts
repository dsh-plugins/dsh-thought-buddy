export interface BuddyConfig { enabled: boolean; mode: 'avatar' | 'emoji'; size: number; emojis: string[] }
export const defaults: BuddyConfig = { enabled: true, mode: 'avatar', size: 18, emojis: ['🤿','🫧','🌊','🐙','🔍','🧠','💭'] };
