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

// 摄影机控制组件数据
export const CAMERA_BODIES = [
  { key: 'sony-venice', label: 'Sony Venice', suffix: 'Shot on Sony Venice, cinematic sensor, wide dynamic range' },
  { key: 'arri-alexa', label: 'ARRI Alexa', suffix: 'Shot on ARRI Alexa Mini LF, cinematic color science, film-like rendering' },
  { key: 'red-v-raptor', label: 'RED V-Raptor', suffix: 'Shot on RED V-Raptor, 8K resolution, high dynamic range, sharp detail' },
  { key: 'canon-c70', label: 'Canon C70', suffix: 'Shot on Canon C70, Super 35 sensor, Canon color science' },
  { key: 'sony-fx6', label: 'Sony FX6', suffix: 'Shot on Sony FX6, full frame, natural color rendering' },
  { key: 'blackmagic-ursa', label: 'Blackmagic URSA', suffix: 'Shot on Blackmagic URSA Mini Pro, film-like Blackmagic color' },
]

export const CAMERA_LENSES = [
  { key: 'zeiss-ultra', label: 'Zeiss Ultra Prime', suffix: 'Zeiss Ultra Prime lens, razor sharp, minimal distortion' },
  { key: 'cooke-sp3', label: 'Cooke SP3', suffix: 'Cooke SP3 lens, warm Cooke Look, organic bokeh' },
  { key: 'arri-signature', label: 'ARRI Signature', suffix: 'ARRI Signature Prime lens, creamy bokeh, cinematic rendering' },
  { key: 'canon-sumire', label: 'Canon Sumire', suffix: 'Canon Sumire Prime lens, soft vintage character, gentle flare' },
  { key: 'leica-summicron', label: 'Leica Summicron-C', suffix: 'Leica Summicron-C lens, classic Leica micro-contrast' },
  { key: 'panavision-primo', label: 'Panavision Primo', suffix: 'Panavision Primo lens, Hollywood cinematic look, smooth bokeh' },
]

export const FOCAL_LENGTHS = [
  { key: '14mm', label: '14mm', suffix: '14mm ultra wide angle, dramatic perspective, expansive view' },
  { key: '24mm', label: '24mm', suffix: '24mm wide angle, environmental context, natural perspective' },
  { key: '35mm', label: '35mm', suffix: '35mm, classic cinematic focal length, natural perspective' },
  { key: '50mm', label: '50mm', suffix: '50mm, human eye perspective, clean rendering' },
  { key: '85mm', label: '85mm', suffix: '85mm portrait lens, flattering compression, subject isolation' },
  { key: '135mm', label: '135mm', suffix: '135mm telephoto, strong background compression, intimate framing' },
]

export const APERTURES = [
  { key: 'f/1.4', label: 'f/1.4', suffix: 'f/1.4 wide open, extremely shallow depth of field, dreamy bokeh' },
  { key: 'f/2', label: 'f/2', suffix: 'f/2, shallow depth of field, smooth background separation' },
  { key: 'f/2.8', label: 'f/2.8', suffix: 'f/2.8, balanced depth of field, versatile sharpness' },
  { key: 'f/4', label: 'f/4', suffix: 'f/4, moderate depth of field, sharp across frame' },
  { key: 'f/5.6', label: 'f/5.6', suffix: 'f/5.6, deep focus, landscape sharpness' },
  { key: 'f/8', label: 'f/8', suffix: 'f/8, maximum sharpness, deep depth of field' },
]
