# Nexus

<p align="center">
  <img src="https://img.shields.io/badge/version-1.50.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg" alt="Platform">
  <img src="https://img.shields.io/badge/license-Proprietary-red.svg" alt="License">
</p>

**Nexus** 是一款强大的 AI 工作流画布应用，让你轻松创建文生图、图生视频等 AI 创作工作流。

---

## ✨ 功能特性

- 🎨 **可视化节点画布** - 拖拽式操作，直观创建工作流
- 🖼️ **文生图工作流** - 支持多种主流 AI 绘图模型
- 🎬 **图生视频工作流** - 一键将静态图片转为动态视频
- 🤖 **智能 AI 助手** - 内置对话助手，辅助创作
- ⚡ **高性能渲染** - GPU/DOM 自动切换，流畅体验
- 💾 **本地存储** - 数据保存在本地，隐私安全
- 🎬 **短剧制作平台** - 一站式短剧创作工作流

### v1.50.0 新增

- 🔧 **修复模型默认设置** - 节点卡片生成后正确使用画布顶部全局设置的绘图/视频模型，不再每次重置
- 📝 **提示词逆推全面增强** - 重构图像分析系统，输出不可变条件 + 18 维度结构化 JSON（主体/面部/发型/服饰/配饰/姿势/环境/光线/相机/构图/风格/色彩/画质等）
- 📥 **视频下载修复** - 修复下载按钮报错和多次点击才响应的问题，增加下载中状态反馈，CORS 自动降级
- 🎬 **首尾帧连接规范** - 切换视频模型时自动重新校验首帧/尾帧/参考图角色分配，防止不兼容报错
- 🐛 **海螺 duration 安全兜底** - 运行时自动将时长约束到模型配置范围，防止非法参数

### v1.47.4 新增

- 🗡️ **手动模式资产管理** - 手动模式新增资产库，支持武器/道具/载具管理
- 🎨 **手动模式融图功能** - 手动模式新增融图入口，支持多图融合
- 🎬 **Veo OpenAI 格式修复** - 修复短剧工作台使用 Veo 视频模型报错的问题

### v1.47.3 新增

- 🖼️ **资产透明背景** - 资产生成自动使用透明 PNG 背景
- 📥 **融图增强** - 融图面板支持从画布、历史素材导入（6 个分类）

### v1.47.2 新增

- 🗡️ **资产同步出图** - 资产（武器/道具/配饰）与角色场景同步批量生成参考图
- ➕ **资产生成按钮** - 资产面板新增"生成参考图"按钮，支持单独生成

### v1.47.1 修复

- 🐛 **修复蒙版编辑器交互问题** - 修复重绘/擦除界面鼠标移开后消失的问题
- 🎯 **优化弹窗显示逻辑** - 全屏弹窗打开时自动隐藏工具栏

### v1.47.0 新增

- 📁 **短剧项目管理** - 支持创建多个短剧项目，持久保存和切换
- 🎬 **视频模型首尾帧提示** - 视频模型选择器显示首帧/尾帧支持状态
- ✏️ **项目复制功能** - 一键复制现有短剧项目

### v1.46.0 新增

- 🐛 **修复剧本拆解报错** - 修复短剧制作台 "cannot access uninitialized variable" 错误
- 🐛 **修复数据丢失问题** - 修复返回画布后人物设定图和场景被删除的严重 Bug
- 🎬 **Veo 视频参数修正** - 修复 Veo OpenAI 格式的时长参数
- ➕ **短剧制作台模型扩展** - 添加所有 Veo 和 Sora OpenAI 格式模型支持

### v1.45.0 新增

- 🎨 **短剧融图功能** - 支持主图 + 最多 13 张副图融合（Gemini 多图融合）
- 🗡️ **资产提取** - 剧本分析自动提取角色资产（武器、道具、载具、配饰等）
- 🎬 **智能脚本生成** - 根据视频模型参数（时长、首尾帧支持）优化生成脚本
- 🖼️ **项目缩略图** - 主页项目卡片自动展示首张生成图片作为缩略图
- 📝 **短剧资产面板** - 支持管理角色使用的重要物品，并可在分镜中引用

### v1.44.0 新增

- 🖌️ **蒙版编辑器重构** - 全屏预览风格，更大的绘制区域
- 🎯 **精确蒙版绘制** - 优化画笔工具，支持撤销/重做
- ✨ **预览优化** - 实时显示蒙版效果

---

## 📥 下载安装

### 最新版本: v1.50.0

| 平台 | 下载链接 | 说明 |
|------|----------|------|
| **macOS (Intel)** | [Nexus_1.50.0_x64.dmg](https://github.com/cookiesen77-rgb/nexus-release/releases/latest) | 适用于 Intel 芯片 Mac |
| **macOS (Apple Silicon)** | [Nexus_1.50.0_aarch64.dmg](https://github.com/cookiesen77-rgb/nexus-release/releases/latest) | 适用于 M1/M2/M3/M4 芯片 Mac |
| **Windows** | [Nexus_1.50.0_x64-setup.exe](https://github.com/cookiesen77-rgb/nexus-release/releases/latest) | 适用于 Windows 10/11 |

👉 [查看所有版本](https://github.com/cookiesen77-rgb/nexus-release/releases)

---

## 🔑 获取 API Key

使用 Nexus 需要配置 API Key 才能使用 AI 功能。

<p align="center">
  <a href="https://nexusapi.cn/" target="_blank">
    <img src="https://img.shields.io/badge/获取%20API%20Key-nexusapi.cn-brightgreen?style=for-the-badge&logo=key" alt="Get API Key">
  </a>
</p>

### 步骤：
1. 访问 **[nexusapi.cn](https://nexusapi.cn/)**
2. 注册/登录账号
3. 在控制台获取你的 API Key
4. 打开 Nexus 应用，进入设置页面
5. 粘贴 API Key 并保存

---

## 🖥️ 系统要求

### macOS
- macOS 10.15 (Catalina) 或更高版本
- Intel 或 Apple Silicon 处理器

### Windows
- Windows 10 (1803) 或更高版本
- x64 处理器

---

## 📸 应用截图

<p align="center">
  <i>可视化节点画布，轻松创建 AI 工作流</i>
</p>

---

## 🛠️ 技术栈

- **前端**: React + TypeScript + Tailwind CSS
- **桌面框架**: Tauri (Rust)
- **状态管理**: Zustand
- **画布引擎**: React Flow

---

## 📄 许可证

本软件为闭源软件，仅供个人使用。

---

## 🔗 相关链接

- 🌐 **API 服务**: [nexusapi.cn](https://nexusapi.cn/)
- 📖 **API 文档**: [nexusapi.cn/docs](https://nexusapi.cn/docs)
- 💰 **价格方案**: [nexusapi.cn/pricing](https://nexusapi.cn/pricing)

---

<p align="center">
  <b>Powered by <a href="https://nexusapi.cn/">nexusapi.cn</a></b>
</p>
