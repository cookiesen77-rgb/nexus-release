/**
 * Chat API Type Declarations
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | string
  content: string | any[]
}

export interface ChatRequestData {
  model?: string
  messages?: ChatMessage[]
  stream?: boolean
  [key: string]: any
}

export function chatCompletions(data: ChatRequestData): Promise<any>
export function createResponse(data: any): Promise<any>
export function extractTextFromResponses(resp: any): string
export function streamResponses(data: any, signal?: AbortSignal): AsyncGenerator<string>
export function streamChatCompletions(data: ChatRequestData, signal?: AbortSignal): AsyncGenerator<string>
