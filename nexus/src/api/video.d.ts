/**
 * Video API Type Declarations
 */

export interface GenerateVideoOptions {
  endpoint?: string
  authMode?: 'bearer' | 'query'
  timeout?: number
}

export function generateVideo(data: any, options?: GenerateVideoOptions): Promise<any>
export function getVideoStatus(taskId: string, options?: any): Promise<any>
