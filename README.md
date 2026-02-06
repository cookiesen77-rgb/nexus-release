# Nexus

一个基于 React Flow 的可视化 AI 创作画布，支持文生图、视频生成等 AI 工作流的节点式编排。默认对接 NexusAPI（`https://nexusapi.cn/v1`）。

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-5.2-646CFF?logo=vite)
![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📥 下载安装

请前往本仓库的 Releases 下载对应平台的安装包（macOS / Windows）：

- Releases: https://github.com/cookiesen77-rgb/nexus-source/releases

## 📸 截图

### 首页
![首页](./doc/home.png)

### 画布
![画布](./doc/canvas.png)

### API 配置
![API 配置](./doc/api-config.png)

## ✨ 特性

- 🎨 **可视化节点编排** - 基于 React Flow 的无限画布，支持拖拽、缩放、连接
- 🖼️ **文生图工作流** - 支持配置提示词、模型、尺寸等参数生成图片
- 🎬 **视频生成工作流** - 支持图生视频，可设置首帧/尾帧图片
- 🧩 **Kling 平台全量接入** - 支持 Kling 生图/生视频、Omni-Video/Omni-Image、多图参考生视频，以及扩展/特效/数字人/口型/动作控制/换装/TTS 等高级工具节点
- 🤖 **AI 提示词润色** - 一键 AI 优化提示词，提升生成质量
- 🔄 **循环生成** - 支持批量循环生成图片/视频（1-10 次）
- 🔁 **重新生成模式** - 可选择新建节点或替换原节点（原内容自动保存到历史）
- 🧷 **参考图顺序可调** - 文生图配置中支持调整参考图顺序，并同步图片节点“参考图1/2”标识
- 🧠 **AI 助手模型选择** - 支持切换不同的 AI 模型用于文本润色
- 🧷 **模型输入限制与提示** - 每个模型在配置节点内展示输入要求（tips），并在 UI/运行时对首帧/尾帧/参考图数量进行限制与校验
- 🌓 **深色/浅色主题** - 支持主题切换，保护眼睛
- 💾 **本地项目存储** - 项目数据本地持久化，支持多项目管理
- ↩️ **撤销/重做** - 完整的操作历史记录
- 🪟 **Windows/Tauri 稳定性增强** - 图片缓存失败时自动兜底下载为 dataURL，避免生成成功但画布不显示

### v1.46.0 新增

- 🐛 **修复剧本拆解报错** - 修复 "cannot access uninitialized variable" 错误
- 🐛 **修复数据丢失问题** - 修复返回画布后人物设定图和场景被删除的严重 Bug
- 🎬 **Veo 视频参数修正** - 修复 Veo OpenAI 格式的时长参数（duration_seconds）
- ➕ **短剧制作台模型扩展** - 添加所有 Veo 和 Sora OpenAI 格式模型支持

### v1.45.0 新增（重点）

- 🎨 **短剧融图功能** - 短剧制作平台支持 Gemini 多图融合（主图 1 张 + 副图最多 13 张）
- 🗡️ **资产提取** - 剧本分析自动提取角色资产（武器、道具、载具、配饰、重要物品）
- 🎬 **智能脚本生成** - 根据视频模型参数（时长、首尾帧支持）和用户风格选择优化脚本
- 🖼️ **项目缩略图** - 主页项目卡片自动展示首张生成图片作为缩略图
- 📝 **短剧资产面板** - 支持管理角色使用的重要物品，融图结果可添加到资产库
- 🔗 **分镜资产引用** - 分镜可引用资产 ID，保持物品一致性

### v1.44.0 新增

- 🖌️ **蒙版编辑器重构** - 全屏预览风格，更大的绘制区域
- 🎯 **精确蒙版绘制** - 优化画笔工具，支持撤销/重做
- ✨ **预览优化** - 实时显示蒙版效果

### v1.30.0 新增（重点）

- 🔗 **多选节点批量连线** - 选中多个节点后，可从任一节点拖出连线，显示所有选中节点到目标的预览线，松开后批量创建连接
- 🎥 **3D 相机控制器** - 新增可视化相机控制组件，支持左右旋转、俯仰角度、推进特写、广角镜头等参数调节
- 🖼️ **导演台素材选择** - 导演台新增从画布节点和历史素材中选择参考图功能，无需重复上传
- 🔧 **相机控制方向修正** - 修复多角度相机控制的方向参数（左右旋转、俯仰角度方向已修正）
- ✨ **文本节点润色优化** - 修复 AI 润色功能的兼容性问题
- 📥 **视频下载修复** - 修复视频下载 CORS 问题，支持更稳定的下载体验

### v0.1.1 新增

- 接入 7 个新视频模型：`doubao-seedance-1-5-pro-251215`、`wan2.6-i2v`、`MiniMax-Hailuo-2.3`、`MiniMax-Hailuo-2.3-Fast`、`kling-omni-video`、`luma_video_api`、`runwayml-gen3a_turbo-10`
- Kling 平台全量模型/能力接入：新增 `klingVideoTool / klingImageTool / klingAudioTool` 三类工具节点，并支持创建任务、轮询状态、回填视频/图片/音频 URL
- 配置节点展示各模型输入说明（tips），并对首帧/尾帧/参考图进行模型级限制与运行时校验

### v0.0.55 新增

- 修复 Sora 2 OpenAI 官方格式视频生成和下载
- 修复视频状态查询端点路径问题
- 优化 Web 环境下需要鉴权的视频下载（自动转换为 blob URL）
- 优化 Tauri 环境下视频缓存机制
- 修复全局错误处理，避免不必要的弹窗干扰

### v0.0.51 新增

- 新增 Sora 2 OpenAI 官方格式视频模型
- 新增循环生成功能（图片/视频配置节点）
- 新增 AI 助手模型全局设置
- 新增重新生成模式设置（替换/新建）
- 优化全局错误处理，减少不必要的弹窗
- 修复多个视频生成相关问题

## 📦 节点类型

| 节点 | 描述 |
|------|------|
| **文本节点** | 输入/编辑提示词文本 |
| **文生图配置** | 配置图片生成参数（模型、尺寸、数量等） |
| **图片节点** | 展示生成的图片或上传本地图片 |
| **视频生成配置** | 配置视频生成参数（支持首帧/尾帧图片） |
| **视频节点** | 展示生成的视频 |
| **音频节点** | 展示生成/导入的音频 |
| **本地保存** | 将产物落盘保存到本地 |
| **Kling 视频工具** | Kling 平台高级视频工具（扩展/特效/数字人/动作控制/口型等） |
| **Kling 图片工具** | Kling 平台高级图片工具（多主体/扩图/换装/识别/自定义元素等） |
| **Kling 音频工具** | Kling 平台音频工具（文生音效/视频转音效/TTS/声音管理等） |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- pnpm / npm / yarn

### 安装

```bash
# 克隆项目
git clone <YOUR_REPO_URL> nexus
cd nexus

# 安装依赖
pnpm install
# 或
npm install

# 启动开发服务器
pnpm dev
# 或
npm run dev
```

### 构建

```bash
pnpm build
# 或
npm run build
```

桌面端（Tauri）构建：

```bash
# 常规
npm run build:tauri

# 若你的环境 CI=1 导致 tauri --ci 参数报错，可用：
CI=false npm run build:tauri
```

## ⚙️ 配置

首次使用需要配置 API：

1. 点击右上角设置图标 ⚙️
2. 填入 API Key（Base URL 已锁定为 `https://nexusapi.cn/v1`）
3. 选择需要使用的模型

支持 OpenAI 兼容的 API 接口。

## 🛠️ 技术栈

- **框架**: [React 18](https://react.dev/) + [Vite](https://vitejs.dev/)
- **桌面端**: [Tauri 2.0](https://tauri.app/)
- **画布**: [React Flow](https://reactflow.dev/)
- **样式**: [Tailwind CSS](https://tailwindcss.com/)
- **图标**: [Lucide React](https://lucide.dev/)
- **路由**: [React Router](https://reactrouter.com/)

## 📁 项目结构

```
src/
├── api/          # API 请求封装
├── assets/       # 静态资源
├── components/   # 组件
│   ├── nodes/    # 节点组件
│   └── edges/    # 边组件
├── hooks/        # 组合式函数
├── router/       # 路由配置
├── stores/       # 状态管理
├── utils/        # 工具函数
└── views/        # 页面视图
```

## 🔄 自动执行工作流

开启「自动执行」模式后，系统会通过 AI 分析用户意图，自动编排并执行工作流。

### 工作流类型

| 类型 | 触发条件 | 说明 |
|------|---------|------|
| `text_to_image` | 默认 | 文生图工作流 |
| `text_to_image_to_video` | 包含"视频"、"动画"等关键词 | 文生图生视频工作流 |
| `storyboard` | 包含"分镜"、"场景"、"镜头"等关键词 | 分镜工作流 |

### 工作流 1: 文生图 / 文生图生视频

![工作流架构](./doc/workflow.png)

### 工作流 2: 分镜工作流 (Storyboard)

![分镜工作流](./doc/workflow2.png)

**示例输入:** `蜡笔小新去上学。分镜一：清晨的战争；分镜二：出发的风姿`

**AI 解析:**
- 提取角色: 蜡笔小新 (外观描述)
- 拆分分镜: 清晨的战争、出发的风姿

**执行流程:**
1. 生成角色参考图
2. 依次生成各分镜图片 (连接角色参考图保持一致性)

### 执行流程

1. **AI 意图分析** - 分析用户输入，判断工作流类型，生成优化后的提示词
2. **创建节点** - 按顺序创建文本节点和配置节点
3. **串行执行** - 配置节点自动执行，等待上一步完成后再执行下一步
4. **输出结果** - 生成图片/视频节点展示结果

### 核心组件

- `useWorkflowOrchestrator` - 工作流编排器 Hook
- `waitForConfigComplete` - 等待配置节点完成
- `waitForOutputReady` - 等待输出节点就绪

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 联系我

扫码添加微信交流：

<img src="./doc/wx-group.jpg" width="200" alt="微信二维码" />

## 📄 License

[MIT](./LICENSE)
