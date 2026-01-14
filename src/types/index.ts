export interface ChatService {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  brandColor?: string;
  enabled: boolean;
  order: number;
  isBuiltin?: boolean;
}

export interface ChatMessage {
  id: string;
  serviceId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  conversationId?: string;
}

export interface Conversation {
  id: string;
  serviceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export const DEFAULT_SERVICES: ChatService[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    iconUrl: 'https://cdn.oaistatic.com/assets/favicon-o20kmmos.svg',
    brandColor: '#00A67E',
    enabled: true,
    order: 0,
    isBuiltin: true,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    iconUrl: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
    brandColor: '#4796E3',
    enabled: true,
    order: 1,
    isBuiltin: true,
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    iconUrl: 'https://claude.ai/favicon.ico',
    brandColor: '#DA7756',
    enabled: true,
    order: 2,
    isBuiltin: true,
  },
  {
    id: 'grok',
    name: 'Grok',
    url: 'https://grok.com',
    iconUrl: 'https://grok.com/favicon.ico',
    brandColor: '#000000',
    enabled: false,
    order: 3,
    isBuiltin: true,
  },
  {
    id: 'copilot',
    name: 'Copilot',
    url: 'https://copilot.microsoft.com',
    iconUrl: 'https://copilot.microsoft.com/favicon.ico',
    brandColor: '#00A2ED',
    enabled: false,
    order: 4,
    isBuiltin: true,
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://perplexity.ai',
    iconUrl: 'https://www.perplexity.ai/favicon.ico',
    brandColor: '#21808D',
    enabled: false,
    order: 5,
    isBuiltin: true,
  },
  {
    id: 'poe',
    name: 'Poe',
    url: 'https://poe.com',
    iconUrl: 'https://poe.com/favicon.ico',
    brandColor: '#B92B27',
    enabled: false,
    order: 6,
    isBuiltin: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    iconUrl: 'https://chat.deepseek.com/favicon.svg',
    brandColor: '#4D6BFE',
    enabled: false,
    order: 7,
    isBuiltin: true,
  },
  {
    id: 'qwen',
    name: '通义千问',
    url: 'https://tongyi.aliyun.com/qianwen',
    iconUrl:
      'https://img.alicdn.com/imgextra/i1/O1CN01AKUdFc1l0o4yoOHVd_!!6000000004758-2-tps-512-512.png',
    brandColor: '#6366F1',
    enabled: false,
    order: 8,
    isBuiltin: true,
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://kimi.moonshot.cn',
    iconUrl: 'https://statics.moonshot.cn/kimi-chat/favicon.ico',
    brandColor: '#000000',
    enabled: false,
    order: 9,
    isBuiltin: true,
  },
  {
    id: 'doubao',
    name: '豆包',
    url: 'https://www.doubao.com/chat',
    iconUrl: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/logo-doubao-overflow.png',
    brandColor: '#FF6B35',
    enabled: false,
    order: 10,
    isBuiltin: true,
  },
  {
    id: 'glm',
    name: '智谱清言',
    url: 'https://chatglm.cn',
    iconUrl: 'https://chatglm.cn/favicon.ico',
    brandColor: '#1E3A8A',
    enabled: false,
    order: 11,
    isBuiltin: true,
  },
];
