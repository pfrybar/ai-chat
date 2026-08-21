import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  content: string;
}

function createClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

export function getChatModels() {
  const configuredModels = (process.env.OPENAI_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return configuredModels.length > 0
    ? [...new Set(configuredModels)]
    : ['gpt-4o-mini'];
}

export async function completeChat(
  messages: ChatMessage[],
  model: string,
): Promise<ChatResult> {
  const client = createClient();
  const completion = await client.chat.completions.create({
    messages: messages as ChatCompletionMessageParam[],
    model,
  });
  const content = completion.choices[0]?.message.content;

  if (!content) {
    throw new Error('The model returned an empty response.');
  }

  return { content };
}
