export interface ChatService {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  enabled: boolean;
  order: number;
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
    enabled: true,
    order: 0,
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    iconUrl: 'https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg',
    enabled: true,
    order: 1,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    iconUrl: 'https://chat.deepseek.com/favicon.svg',
    enabled: false,
    order: 2,
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    iconUrl: 'https://claude.ai/favicon.ico',
    enabled: false,
    order: 3,
  },
];
