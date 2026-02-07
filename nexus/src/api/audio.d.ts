/**
 * Audio API Type Declarations
 */

export interface GenerateAudioOptions {
  endpoint?: string
  authMode?: 'bearer' | 'query'
  timeout?: number
}

export function generateAudio(data: any, options?: GenerateAudioOptions): Promise<any>
export function getAudioStatus(taskId: string, options?: any): Promise<any>
