/**
 * useInView - 使用 IntersectionObserver 检测元素是否在可视区域
 * 用于实现图片/视频懒加载，提升大画布性能
 */
import { useState, useEffect, useRef, RefObject } from 'react'

interface UseInViewOptions {
  /** 触发阈值，0-1 之间，默认 0（边缘进入即触发） */
  threshold?: number
  /** 根元素边距，可用于提前加载 */
  rootMargin?: string
  /** 是否只触发一次（进入后不再监听） */
  triggerOnce?: boolean
  /** 初始状态，默认 false */
  initialInView?: boolean
}

interface UseInViewReturn {
  ref: RefObject<HTMLDivElement>
  inView: boolean
}

export function useInView(options: UseInViewOptions = {}): UseInViewReturn {
  const {
    threshold = 0,
    rootMargin = '100px', // 提前 100px 开始加载
    triggerOnce = true,
    initialInView = false
  } = options

  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(initialInView)
  const hasTriggeredRef = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // 如果已经触发过且设置了 triggerOnce，直接返回
    if (triggerOnce && hasTriggeredRef.current) return

    // 检查浏览器是否支持 IntersectionObserver
    if (typeof IntersectionObserver === 'undefined') {
      // 不支持时直接设置为可见
      setInView(true)
      hasTriggeredRef.current = true
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return

        if (entry.isIntersecting) {
          setInView(true)
          hasTriggeredRef.current = true

          // 如果只触发一次，断开观察
          if (triggerOnce) {
            observer.disconnect()
          }
        } else if (!triggerOnce) {
          setInView(false)
        }
      },
      {
        threshold,
        rootMargin
      }
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [threshold, rootMargin, triggerOnce])

  return { ref, inView }
}

export default useInView
