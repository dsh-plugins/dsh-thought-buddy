import type { HostAPI, CordisContext } from '@dsh-plugin/dsh-loader';
import type { BuddyConfig } from './config.js';
import { template } from './config-template.js';
export const name = '@dsh-plugin/dsh-thought-buddy';
export const inject = ['dshLoader'];
export async function apply(ctx: CordisContext & { dshLoader: HostAPI }) {
  await ctx.dshLoader.config.register<BuddyConfig>(ctx, template);
}
