/**
 * 海螺视频API测试脚本
 * 测试首尾帧视频生成
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://nexusapi.cn';

// 从环境变量或本地存储获取 API Key
const getApiKey = () => {
  // 尝试从环境变量获取
  if (process.env.NEXUS_API_KEY) return process.env.NEXUS_API_KEY;

  // 尝试从 nexus 项目的 localStorage 模拟文件获取
  try {
    const configPath = path.join(__dirname, '../nexus/.api_key');
    if (fs.existsSync(configPath)) {
      return fs.readFileSync(configPath, 'utf8').trim();
    }
  } catch {}

  return null;
};

// 图片转 base64
const imageToBase64 = (filePath) => {
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
};

// 上传图片到云雾图床
const uploadImage = async (base64Data, apiKey) => {
  const match = base64Data.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error('Invalid base64 data');

  const mimeType = match[1];
  const base64Content = match[2];
  const buffer = Buffer.from(base64Content, 'base64');

  const ext = mimeType.split('/')[1] || 'png';
  const fileName = `image.${ext}`;

  // 创建 FormData
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, { filename: fileName, contentType: mimeType });

  const response = await fetch('https://imageproxy.zhongzhuan.chat/api/upload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...form.getHeaders()
    },
    body: form
  });

  const result = await response.json();
  const url = result?.url || result?.data?.url || result?.data?.link;
  if (!url) throw new Error('Upload failed: ' + JSON.stringify(result));
  return url;
};

// 创建视频任务
const createVideoTask = async (payload, apiKey) => {
  console.log('\n=== 创建视频任务 ===');
  console.log('Payload:', JSON.stringify(payload, null, 2));

  const response = await fetch(`${API_BASE}/minimax/v1/video_generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  console.log('Response:', JSON.stringify(result, null, 2));
  return result;
};

// 查询任务状态
const queryTask = async (taskId, apiKey) => {
  const response = await fetch(`${API_BASE}/minimax/v1/query/video_generation?task_id=${taskId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });

  return await response.json();
};

// 等待任务完成
const waitForCompletion = async (taskId, apiKey, maxAttempts = 120) => {
  console.log('\n=== 等待任务完成 ===');

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000));

    const result = await queryTask(taskId, apiKey);
    const status = result?.status || result?.data?.status || '';
    const videoUrl = result?.file_id || result?.data?.file_id || result?.video_url || result?.data?.video_url;

    console.log(`[${i + 1}/${maxAttempts}] Status: ${status}, Video: ${videoUrl ? 'Yes' : 'No'}`);

    if (status === 'Success' || status === 'Finished' || videoUrl) {
      console.log('\n=== 任务完成 ===');
      console.log('Result:', JSON.stringify(result, null, 2));
      return result;
    }

    if (status === 'Failed' || status === 'Error') {
      throw new Error('Task failed: ' + JSON.stringify(result));
    }
  }

  throw new Error('Timeout waiting for task completion');
};

// 主测试函数
const main = async () => {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('请设置 NEXUS_API_KEY 环境变量');
    process.exit(1);
  }

  const testDir = __dirname;
  const firstFramePath = path.join(testDir, '首帧.png');
  const lastFramePath = path.join(testDir, '尾帧.png');
  const promptPath = path.join(testDir, '提示词.txt');

  const prompt = fs.readFileSync(promptPath, 'utf8').trim();

  console.log('=== 海螺视频API测试 ===');
  console.log('首帧:', firstFramePath);
  console.log('尾帧:', lastFramePath);
  console.log('提示词长度:', prompt.length);

  // 测试1: 首尾帧视频（使用完整参数）
  console.log('\n\n========== 测试1: 首尾帧视频 ==========');
  try {
    // 上传图片
    console.log('\n上传首帧...');
    const firstFrameBase64 = imageToBase64(firstFramePath);
    const firstFrameUrl = await uploadImage(firstFrameBase64, apiKey);
    console.log('首帧URL:', firstFrameUrl);

    console.log('\n上传尾帧...');
    const lastFrameBase64 = imageToBase64(lastFramePath);
    const lastFrameUrl = await uploadImage(lastFrameBase64, apiKey);
    console.log('尾帧URL:', lastFrameUrl);

    // 首尾帧视频请求
    const payload = {
      model: 'MiniMax-Hailuo-2.3',
      prompt: prompt,
      duration: 6,
      first_frame_image: firstFrameUrl,
      last_frame_image: lastFrameUrl,
      resolution: '768P',
      prompt_optimizer: true
    };

    const task = await createVideoTask(payload, apiKey);

    if (task?.status === 'error' || task?.base_resp?.status_code !== 0) {
      console.error('创建任务失败:', task?.base_resp?.status_msg || task?.message);
    } else if (task?.task_id) {
      await waitForCompletion(task.task_id, apiKey);
    }
  } catch (err) {
    console.error('测试1失败:', err.message);
  }

  // 测试2: 纯文生视频（只有 model, prompt, duration）
  console.log('\n\n========== 测试2: 纯文生视频 ==========');
  try {
    const payload = {
      model: 'MiniMax-Hailuo-02',
      prompt: '一只可爱的小猫在草地上玩耍',
      duration: 6
    };

    const task = await createVideoTask(payload, apiKey);

    if (task?.status === 'error' || task?.base_resp?.status_code !== 0) {
      console.error('创建任务失败:', task?.base_resp?.status_msg || task?.message);
    } else if (task?.task_id) {
      console.log('纯文生视频任务创建成功，task_id:', task.task_id);
      // 不等待完成，只验证创建成功
    }
  } catch (err) {
    console.error('测试2失败:', err.message);
  }

  // 测试3: 图生视频（只有首帧，无尾帧）
  console.log('\n\n========== 测试3: 图生视频（仅首帧） ==========');
  try {
    console.log('\n上传首帧...');
    const firstFrameBase64 = imageToBase64(firstFramePath);
    const firstFrameUrl = await uploadImage(firstFrameBase64, apiKey);

    const payload = {
      model: 'MiniMax-Hailuo-2.3',
      prompt: prompt.slice(0, 500),
      duration: 6,
      first_frame_image: firstFrameUrl,
      resolution: '768P',
      prompt_optimizer: true
    };

    const task = await createVideoTask(payload, apiKey);

    if (task?.status === 'error' || task?.base_resp?.status_code !== 0) {
      console.error('创建任务失败:', task?.base_resp?.status_msg || task?.message);
    } else if (task?.task_id) {
      console.log('图生视频任务创建成功，task_id:', task.task_id);
    }
  } catch (err) {
    console.error('测试3失败:', err.message);
  }
};

main().catch(console.error);
