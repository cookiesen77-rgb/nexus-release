/**
 * Audio API | 音频生成 API (Suno)
 */

import { request } from '@/utils'

export const createMusicTask = (data) =>
  request({
    url: '/suno/submit/music',
    method: 'post',
    data
  })

export const fetchMusicTask = async (taskId) => {
  if (!taskId) throw new Error('缺少 task_id')

  try {
    return await request({
      url: '/suno/fetch',
      method: 'post',
      data: { task_id: taskId }
    })
  } catch (err) {
    const status = err?.response?.status
    if (status === 405 || status === 404) {
      return request({
        url: '/suno/fetch',
        method: 'get',
        params: { task_id: taskId }
      })
    }
    throw err
  }
}
