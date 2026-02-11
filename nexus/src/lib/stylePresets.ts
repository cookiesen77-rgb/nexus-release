export interface StylePreset {
  id: string
  name: string
  promptSuffix: string
  thumbnail?: string
  builtIn?: boolean
}

export const BUILT_IN_STYLE_PRESETS: StylePreset[] = [
  {
    id: 'style_anime',
    name: '动漫',
    promptSuffix: 'anime style, cel shading, vibrant colors, clean lines, detailed eyes, high quality anime illustration',
    builtIn: true,
  },
  {
    id: 'style_photorealistic',
    name: '写实',
    promptSuffix: 'photorealistic, ultra detailed, 8K, sharp focus, natural lighting, professional photography',
    builtIn: true,
  },
  {
    id: 'style_oil_painting',
    name: '油画',
    promptSuffix: 'oil painting style, visible brushstrokes, rich color palette, classical fine art, canvas texture',
    builtIn: true,
  },
  {
    id: 'style_watercolor',
    name: '水彩',
    promptSuffix: 'watercolor painting, soft gradients, paper texture, delicate washes, transparent layers, artistic',
    builtIn: true,
  },
  {
    id: 'style_comic',
    name: '漫画',
    promptSuffix: 'comic book style, bold outlines, halftone dots, dramatic shading, speech bubbles, pop art colors',
    builtIn: true,
  },
  {
    id: 'style_3d_render',
    name: '3D',
    promptSuffix: '3D render, Octane render, volumetric lighting, subsurface scattering, high polygon, studio lighting',
    builtIn: true,
  },
  {
    id: 'style_pixel_art',
    name: '像素',
    promptSuffix: 'pixel art, 16-bit style, retro game aesthetic, limited color palette, crisp pixels, nostalgic',
    builtIn: true,
  },
  {
    id: 'style_cinematic',
    name: '电影',
    promptSuffix: 'cinematic, film grain, anamorphic lens, dramatic lighting, color grading, shallow depth of field, 35mm film',
    builtIn: true,
  },
]
