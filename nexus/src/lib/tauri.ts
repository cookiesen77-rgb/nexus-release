type Invoke = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>

let cached: null | { isTauri: boolean; invoke: Invoke | null; convertFileSrc?: any } = null

export const getTauri = async () => {
  if (cached) return cached
  try {
    const core = await import('@tauri-apps/api/core')
    const isTauri = !!core?.isTauri?.()
    cached = { isTauri, invoke: (core?.invoke as Invoke) || null, convertFileSrc: core?.convertFileSrc }
    return cached
  } catch {
    cached = { isTauri: false, invoke: null }
    return cached
  }
}

export const tauriInvoke = async <T,>(command: string, payload?: Record<string, unknown>): Promise<T | null> => {
  const t = await getTauri()
  if (!t.isTauri || typeof t.invoke !== 'function') return null
  try {
    return await t.invoke(command, payload)
  } catch (err: unknown) {
    // 记录 Tauri 命令调用错误以便调试
    console.error(`[tauriInvoke] 命令 '${command}' 执行失败:`, err)
    throw err // 将错误抛出，让调用方决定如何处理
  }
}
