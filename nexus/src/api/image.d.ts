/**
 * Image API Type Declarations
 */

export interface GenerateImageOptions {
  requestType?: 'json' | 'formdata'
  endpoint?: string
  authMode?: 'bearer' | 'query'
  timeout?: number
}

export function generateImage(data: any, options?: GenerateImageOptions): Promise<any>
