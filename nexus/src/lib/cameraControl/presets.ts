export interface CameraPreset {
  name: string
  description: string
  promptSuffix: string
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    name: 'Sony A7III 35mm',
    description: '浅景深人像',
    promptSuffix: 'Shot on Sony A7III, 35mm f/1.4 lens, shallow depth of field, natural colors, cinematic bokeh, full frame sensor',
  },
  {
    name: 'Canon R5 85mm',
    description: '奶化背景人像',
    promptSuffix: 'Shot on Canon EOS R5, 85mm f/1.2 lens, creamy bokeh, warm tones, sharp subject isolation, professional portrait',
  },
  {
    name: 'Fuji Velvia 50',
    description: '高饱和风景',
    promptSuffix: 'Fujifilm Velvia 50 film, highly saturated colors, fine grain, vivid landscapes, rich contrast, slide film look',
  },
  {
    name: 'Kodak Portra 400',
    description: '温暖胶片人像',
    promptSuffix: 'Kodak Portra 400 film, warm skin tones, soft pastel colors, gentle grain, portrait photography, analog feel',
  },
  {
    name: 'Leica M11 50mm',
    description: '经典街拍',
    promptSuffix: 'Shot on Leica M11, 50mm Summilux f/1.4, classic rendering, micro-contrast, street photography, rangefinder look',
  },
  {
    name: 'iPhone 15 Pro',
    description: '计算摄影',
    promptSuffix: 'Shot on iPhone 15 Pro, 24mm lens, computational photography, HDR, natural smartphone look, Deep Fusion detail',
  },
  {
    name: 'Hasselblad 907X',
    description: '中画幅质感',
    promptSuffix: 'Shot on Hasselblad 907X, medium format, extraordinary detail, wide tonal range, fashion photography, 100MP sensor',
  },
  {
    name: 'Nikon Z9 70-200mm',
    description: '体育/动态',
    promptSuffix: 'Shot on Nikon Z9, 70-200mm f/2.8, fast action freeze, sports photography, telephoto compression, sharp detail',
  },
  {
    name: 'Cinestill 800T',
    description: '电影胶片夜景',
    promptSuffix: 'Cinestill 800T tungsten film, halation effect, blue-orange color cast, cinematic night photography, film grain',
  },
  {
    name: 'Polaroid SX-70',
    description: '宝丽来即时',
    promptSuffix: 'Polaroid SX-70 instant film, soft focus, muted vintage colors, white border, nostalgic feel, lo-fi aesthetic',
  },
]
