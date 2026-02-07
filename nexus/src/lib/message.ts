/**
 * 全局消息系统（轻量实现）
 * 与 Vue 版本的 window.$message 兼容
 */

type MessageType = 'success' | 'warning' | 'error' | 'info'

const createToast = (type: MessageType, content: string, duration = 3000) => {
  const colors: Record<MessageType, { bg: string; border: string; text: string }> = {
    success: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
    warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
    error: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
    info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' }
  }

  const icons: Record<MessageType, string> = {
    success: '✓',
    warning: '⚠',
    error: '✕',
    info: 'ℹ'
  }

  const c = colors[type]

  const toast = document.createElement('div')
  toast.className = 'nexus-toast'
  toast.innerHTML = `
    <span style="font-weight: bold; margin-right: 8px;">${icons[type]}</span>
    <span>${content}</span>
  `
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 20px;
    border-radius: 8px;
    border: 1px solid ${c.border};
    background: ${c.bg};
    color: ${c.text};
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    animation: nexus-toast-in 0.3s ease;
  `

  // 添加动画样式（如果还没有）
  if (!document.getElementById('nexus-toast-style')) {
    const style = document.createElement('style')
    style.id = 'nexus-toast-style'
    style.textContent = `
      @keyframes nexus-toast-in {
        from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes nexus-toast-out {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
      }
    `
    document.head.appendChild(style)
  }

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.animation = 'nexus-toast-out 0.3s ease'
    setTimeout(() => {
      toast.remove()
    }, 300)
  }, duration)
}

// 消息 API
export const message = {
  success: (content: string, duration?: number) => createToast('success', content, duration),
  warning: (content: string, duration?: number) => createToast('warning', content, duration),
  error: (content: string, duration?: number) => createToast('error', content, duration),
  info: (content: string, duration?: number) => createToast('info', content, duration)
}

// 挂载到 window（兼容 Vue 版本）
declare global {
  interface Window {
    $message?: typeof message
  }
}

export const initGlobalMessage = () => {
  window.$message = message
}
