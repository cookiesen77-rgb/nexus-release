# NexusAPI 配置指南

本项目已配置为使用 NexusAPI (https://nexusapi.cn) 作为 AI 模型中转站。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

启动项目后，点击右上角的「设置」按钮，填写：

- **Base URL**: `https://nexusapi.cn/v1`（已锁定，无法修改）
- **API Key**: 你的 NexusAPI 密钥

### 3. 启动项目

```bash
npm run dev
```

## 支持的模型

> 说明：以下 model 名称以你指定的为准（不要改名）。后续新增/删改模型，请改 `src/config/models.js` 并同步更新 `api/NEXUSAPI_MODEL_ROUTING.md`。

### AI 助手（文本）

- `gpt-5-mini`（Responses：`POST /v1/responses`，默认主助手）
- `gemini-3-pro-preview`（Gemini v1beta：`/v1beta/models/...:generateContent?key=...`，可选）

### 生图（Images）

- `gemini-3-pro-image-preview`（Gemini v1beta：`/v1beta/models/...:generateContent?key=...`；UI 展示名：`nano-banana-pro`）
- `gpt-image-1.5-all`（OpenAI Images：`POST /v1/images/generations`）
- `flux-pro-1.1-ultra`（OpenAI Images：`POST /v1/images/generations`）
- `doubao-seedream-4-5-251128`（OpenAI Images：`POST /v1/images/generations`，`size` 支持 `1K/2K/4K`）
- `qwen-image-max`（OpenAI Chat：`POST /v1/chat/completions`）
- `grok-4-image`（OpenAI Chat：`POST /v1/chat/completions`）
- `qwen-image-edit-2509`（OpenAI Images 编辑：`POST /v1/images/generations`，需要 `image`）
- `kling-image`（Kling：`POST /kling/v1/images/generations`；固定 `model_name=kling-v2-1`）
- `aigc-image-gem` / `aigc-image-qwen`（Tencent-VOD：`POST /tencent-vod/v1/aigc-image`）

### 视频（Videos）

- `veo_3_1-fast`（OpenAI 视频格式：`POST /v1/videos`，轮询 `GET /v1/videos/{id}`，需要垫图 file）
- `veo3.1-4k`（统一视频格式：`POST /v1/video/create`，轮询 `GET /v1/video/query?id=...`）
- `veo3.1-pro-4k`（统一视频格式：同上）
- `sora-2-all`（统一视频格式：同上）
- `kling-video`（Kling：文生 `/kling/v1/videos/text2video`；图生 `/kling/v1/videos/image2video`；固定 `kling-v2-6 · pro · 10s · sound=off`）
- `aigc-video-vidu` / `aigc-video-hailuo`（Tencent-VOD：`POST /tencent-vod/v1/aigc-video`；当前仅支持直接返回 `video_url`）

## API 端点

项目使用以下 API 端点：

- **Gemini 文本**: `POST https://nexusapi.cn/v1beta/models/<model>:generateContent?key=...`
- **Gemini 生图**: `POST https://nexusapi.cn/v1beta/models/<model>:generateContent?key=...`
- **Responses（主助手）**: `POST /v1/responses`
- **对话（OpenAI 兼容）**: `POST /v1/chat/completions`
- **生图（OpenAI 兼容）**: `POST /v1/images/generations`
- **视频（OpenAI 视频格式）**: `POST /v1/videos`，查询 `GET /v1/videos/{id}`
- **视频（统一视频格式）**: `POST /v1/video/create`，查询 `GET /v1/video/query?id=...`
- **Kling 生图**: `POST /kling/v1/images/generations`，查询 `GET /kling/v1/images/generations/{id}`
- **Kling 视频**: `POST /kling/v1/videos/text2video` / `POST /kling/v1/videos/image2video`，查询 `GET /kling/v1/videos/*/{id}`

## 工作流使用

### 1. TEXT_TO_IMAGE (文生图)

```
[文本节点] → [图片配置节点] → [图片节点]
```

### 2. TEXT_TO_IMAGE_TO_VIDEO (文生图生视频)

```
[图片提示词] → [图片配置] → [图片]
[视频提示词] → [视频配置] → [视频]
                    ↑ (连接图片)
```

### 3. STORYBOARD (分镜工作流)

```
[角色描述] → [图片配置] → [角色参考图]
                              ↓
[分镜1文本] → [图片配置] → [分镜1图]
[分镜2文本] → [图片配置] → [分镜2图]
```

### 4. MULTI_ANGLE_STORYBOARD (多角度分镜)

```
[主角色图] ──┬──> [正视提示词] → [图片配置] → [正视图]
            ├──> [侧视提示词] → [图片配置] → [侧视图]
            ├──> [后视提示词] → [图片配置] → [后视图]
            └──> [俯视提示词] → [图片配置] → [俯视图]
```

## 注意事项

1. **API Key 安全**：API Key 仅保存在浏览器本地存储中，不会上传到服务器
2. **项目存储**：项目元数据存 `localStorage`，画布数据存 `IndexedDB`（避免超额）
3. **模型维护**：新增/删改模型请以 `src/config/models.js` 为准，并同步 `api/NEXUSAPI_MODEL_ROUTING.md`
4. **视频生成**：统一视频格式走 `/v1/video/create`；OpenAI 视频格式走 `/v1/videos`（multipart + file）

## 获取 API Key

访问 [NexusAPI 模型广场](https://nexusapi.cn/pricing) 查看模型价格和获取 API Key。

## 技术栈

- Vue 3 + Vite
- Vue Flow (无限画布)
- Naive UI (组件库)
- Axios (HTTP 请求)
- Tailwind CSS (样式)

## 项目结构

```
src/
├── api/              # API 调用封装
├── components/       # 组件
│   ├── nodes/       # 节点组件
│   └── edges/       # 边组件
├── config/          # 配置文件
│   └── models.js    # 模型配置
├── hooks/           # Vue hooks
├── stores/          # 状态管理
└── utils/           # 工具函数
    └── request.js   # HTTP 请求配置
```

## 常见问题

### 功能问答

**Q1：渠道、价格不同，为什么？**  
A：同样的产品，模型公司不会只给一个分销商卖，所以会有不同的渠道与价格。

**Q2：为什么同样的大模型，没有官方的效果好？**  
A：常见原因是分辨率、时长、模型版本没配置好，比如 `veo3.1` 和 `veo3.1-fast` 效果不同；`banana` 的 `1K` 与 `4K` 也不同。  
另外 `sora2` 生成分辨率随机在 480p-720p，属于模型本身特性，可多次重试。

**Q3：不同分组有什么不同？**  
A：理论上越贵的分组并发数量和生成速度越快（可自行测试），质量与稳定性一致，不稳定通道会下架。

**Q4：刚注册调试时出现“请求失败, 如果多次出现，请联系客服”？**  
A：99% 是余额不足。

**Q5：同一个模型为什么有那么多名字？（如 sora2、sora_2、sora.2）**  
A：因为渠道和价格不同，但大模型是同一个，需要用不同名字区分。调用时务必使用模型广场上的**准确名称**。

**Q6：后台怎么看生成好的视频？**  
A：控制台 → 任务日志 → 任务 ID（点开后滚动找到 mp4）。

**Q7：生成内容保存多久？**  
A：2 小时到 48 小时不等，请尽快下载。

**Q8：站内一些功能问题（比如 VEO3.1 改不了横屏）**  
A：站内仅做演示与 API 提供，功能可能有 BUG，建议用站外/三方软件调用。

**Q9：并发问题**  
A：`sora2` 并发 1000，`veo3` 并发 500，并发不受令牌影响。

**Q10：veo3 怎么用首尾帧？**  
A：传两张图片即可，自动作为首尾帧。

**Q11：banana pro 支持多少参考图？**  
A：最多 14 张参考图。

### 报错问答

**Q1：请求发生错误：ELANREFUSED / DNS resolver error**  
A：网页版文档兼容性不好，建议下载 Apifox 进行调试。

**Q2：请求失败, 如果多次出现，请联系客服**  
A：Key 未设置扣费分组顺序。参考：`https://v.douyin.com/nRrhtG84_8o/`

**Q3：网站内调用报错**  
A：站内偶发报错，演示性质为主，建议外调接站。

**Q4：Sora2 报错**  
A：常见原因包括：  
1) 传含真人图（Sora2 不支持真人）  
2) 账户余额不足  
3) 提示词不过审  
4) 令牌分组设置错误  
5) 模型名称未按模型广场填写  
6) 上传图片链接不可用  
7) 参数不符合要求  
8) 模型名称调整未同步（如 `sora-2` 调整后建议改为 `sora-2-all`）  
此类回答具有时效性，建议定期关注公告。

**Q5：VEO3 报错**  
A：参考 Q4，但不包含“真人图限制”。

**Q6：上游分组已满 / 上游负载饱和 / 生成超时**  
A：多为内容审核或参数问题导致的前端渲染提示；也可能是插件/三方传参不正确。  
建议：1) 使用三方工具直连 API；2) 检查模型名；3) 调整提示词或素材；4) 查看任务日志。

**Q7：哪里查看报错详情？**  
A：任务日志 → 任务 ID → 弹出详情（英文可用翻译），结合 Q4/Q5 排查。

**Q8：fal-ai / nano-banana/edit 图片编辑“使用饱和”**  
A：近期封控，暂不可用。

**Q9：Sora2 人脸报错怎么解决？**  
A：1) 建立角色库后调用；2) 使用漫稿图。Sora2 不支持真人图。

**Q10：无可用渠道：当前分组限时特价下对模型 xxx 无可用渠道**  
A：检查令牌分组是否与模型广场中该模型的分组一致。

**Q11：当前分组上游负载已饱和 / 报错 500（sora2 等）**  
A：站内用操练场，建议调用 `sora-2-all`，并优先外接站/软件使用。API 站不适合作为生成网站。

**Q12：使用日志有记录，但任务日志为空**  
A：1) 提交任务参数没成功；2) chat 接口不返参。

## 更新日志

### 2026-01-17

- ✅ 切换到 NexusAPI (https://nexusapi.cn)
- ✅ 更新模型列表，添加最新模型支持
- ✅ 优化 API 配置界面
- ✅ 更新文档和配置说明
