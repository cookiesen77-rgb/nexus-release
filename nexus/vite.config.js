import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import https from 'node:https'
import fs from 'node:fs'

// 读取版本号（优先从 tauri.conf.json，降级到 package.json）
function getAppVersion() {
  try {
    const tauriConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'src-tauri/tauri.conf.json'), 'utf-8'))
    if (tauriConfig.version) return tauriConfig.version
  } catch {}
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
    if (pkg.version) return pkg.version
  } catch {}
  return '0.0.0'
}

// 统一 keep-alive 代理，减少频繁 TLS 握手导致的偶发断连
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  maxFreeSockets: 16
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDesktop = mode === 'electron' || mode === 'tauri'
  const appVersion = getAppVersion()

  return {
    base: isDesktop ? './' : '/nexus/',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src')
      }
    },
    build: {
      chunkSizeWarningLimit: 900,
      rollupOptions: {}
    },
    server: {
      proxy: {
        // 公共代理配置（稳定性优先）
        // eslint-disable-next-line no-unused-vars
        // NOTE: Vite 会传入 (proxy, options)，这里不使用 options
        // 统一 API 代理，绕过 CORS
        '/v1': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          // 增加超时时间（5 分钟）
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          // 配置代理选项
          configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq, req, res) => {
              // 确保正确设置 headers
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Gemini v1beta 接口
        '/v1beta': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Kling 视频接口
        '/kling': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Volc / Seedance（豆包视频）接口
        '/volc': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Ali Bailian（通义万象）接口
        '/alibailian': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // MiniMax（海螺视频）接口
        '/minimax': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Luma 视频接口
        '/luma': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Runway 视频接口
        '/runwayml': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // Tencent VOD 接口
        '/tencent-vod': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        },
        // 视频状态查询接口（allapi.store 统一端点）
        '/video': {
          target: 'https://nexusapi.cn',
          changeOrigin: true,
          secure: true,
          timeout: 300000,
          proxyTimeout: 300000,
          agent: httpsAgent,
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.log('[Proxy Error]', err.message)
            })
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Connection', 'keep-alive')
            })
          }
        }
      }
    }
  }
})
