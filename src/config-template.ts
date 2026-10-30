import { defineConfig } from '@dsh-plugin/dsh-loader/config';
import { defaults } from './config.js';
export const template = defineConfig({ id: 'dsh-thought-buddy', packageName: '@dsh-plugin/dsh-thought-buddy', title: '思考搭子', fields: [
  { type: 'boolean', key: 'enabled', label: '启用', default: defaults.enabled },
  { type: 'select', key: 'mode', label: '显示模式', default: defaults.mode, options: [{ label: '动态头像', value: 'avatar' },{ label: '表情轮播', value: 'emoji' }] },
  { type: 'number', key: 'size', label: '尺寸', default: defaults.size, min: 8, max: 64 },
  { type: 'array', key: 'emojis', label: '表情列表', default: defaults.emojis, min: 1, item: { type: 'text', label: '表情', required: true }, visibleWhen: { path: ['mode'], equals: 'emoji' } },
] });
