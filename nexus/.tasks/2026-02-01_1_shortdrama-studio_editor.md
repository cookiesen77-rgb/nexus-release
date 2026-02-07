# 背景
文件名：2026-02-01_1_shortdrama-studio_editor
创建于：2026-02-01_14:45:00
创建者：mac
主分支：main
任务分支：main
Yolo模式：Off

# 任务描述
1. 短剧制作工作台（自动模式）支持选择默认模型（至少：拆解模型/生图模型/视频模型），并持久化到草稿。
2. 优化自动模式「AI 拆解」区域 UI（更美观、更清晰的步骤化交互）。
3. 修复：从剪辑台返回短剧制作后出现视频/照片版本消失（保存时机问题）。
4. 对标开源剪辑软件并整理剪辑台下一阶段增强方案（含导出成片）。

# 项目概览
Nexus 是基于 React + TypeScript + Tauri 的 AI 工作流画布应用，内置“短剧制作工作台”和“剪辑台（Editor）”。

⚠️ 警告：永远不要修改此部分 ⚠️
- 必须按 RIPER-5 模式执行：RESEARCH/INNOVATE/PLAN/EXECUTE/REVIEW
- EXECUTE 模式只允许实现已批准计划，若需偏离必须回到 PLAN
- 每次实施后必须记录到“任务进度”，并向用户询问“状态：成功/不成功？”
⚠️ 警告：永远不要修改此部分 ⚠️

# 分析
已在 PLAN 模式输出（自动模式缺少模型选择入口；AI 拆解 UI 层级不佳；进入剪辑台跳转与 modal 卸载存在 debounced 保存窗口导致草稿未落盘）。

# 提议的解决方案
按实施清单逐项执行：补齐自动模式模型设置入口、重构 AI 拆解区域 UI、增加跳转前与卸载时的草稿/偏好 flush 保存，并输出剪辑台对标调研结论与可落地的下一阶段方案。

# 当前执行步骤："9. 紧急修复：剪辑台预览/返回不丢 + 全链路历史素材同步"

# 任务进度
[2026-02-01 14:45:00]
- 已修改：.tasks/2026-02-01_1_shortdrama-studio_editor.md
- 更改：创建任务文件
- 原因：跟踪短剧制作与剪辑台相关任务进度
- 阻碍因素：无
- 状态：未确认

[2026-02-01 15:10:00]
- 已修改：src/components/shortDrama/ShortDramaStudioAutoView.tsx src/components/shortDrama/ShortDramaStudioManualView.tsx src/components/canvas/ShortDramaStudioModal.tsx
- 更改：
  - 自动模式新增“默认模型（拆解/生图/视频）”选择入口，并直接写入草稿 models 字段
  - 自动模式 AI 拆解区域重构为“步骤化面板”（拆解 → 关键帧 → 视频），提升信息层级与可读性
  - 修复“从剪辑台返回版本消失”：进入剪辑台前强制 flush 保存 draft/prefs；modal close/unmount 时额外 flush，避免 debounced 保存窗口丢数据
- 原因：满足自动模式可配置默认模型、提升 AI 拆解 UI、解决返回后素材消失的稳定性问题
- 阻碍因素：无
- 状态：未确认

[2026-02-01 15:25:00]
- 已修改：无（调研输出）
- 更改：完成剪辑台对标调研并形成下一阶段增强方案（参考 LosslessCut/Shotcut/Kdenlive 等：以 FFmpeg 的无损裁切/拼接为核心，补齐“导出成片/进度/取消”）
- 原因：提升剪辑台的逻辑性与功能性，优先交付“可导出成片”的硬能力
- 阻碍因素：无
- 状态：未确认

[2026-02-01 15:32:00]
- 已修改：src/components/shortDrama/ShortDramaStudioAutoView.tsx
- 更改：修复自动模式左侧栏内部在大屏触发 `lg:grid-cols-2` 导致列宽过窄（~180px）的问题；将“默认模型”与“剧本导入”内部布局改为单列堆叠，保证 AI 面板与下拉框可读性
- 原因：解决你反馈的“AI 拆解面板排版看不清楚”
- 阻碍因素：无
- 状态：未确认

[2026-02-01 16:05:00]
- 已修改：src/components/shortDrama/ShortDramaSlotVersions.tsx src/components/shortDrama/ShortDramaStudioAutoView.tsx src/components/shortDrama/ShortDramaStudioManualView.tsx
- 更改：
  - 工作台版本列表新增“预览”入口（按钮 + 点击缩略图），支持图片/视频全屏预览
  - 自动/手动模式：点击已采用的缩略图可直接预览
  - 视频预览：在 Tauri 下优先通过 `resolveCachedMediaUrl` 使用缓存后的 `asset://` 地址（更稳定）
- 原因：满足“工作台可预览照片/更方便预览视频”，并提升 Tauri 下视频预览稳定性
- 阻碍因素：无
- 状态：未确认

[2026-02-01 17:10:00]
- 已修改：src/routes/Editor.tsx src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/.gitignore src-tauri/binaries/.gitkeep .github/workflows/release.yml
- 更改：
  - 剪辑台新增“导出成片（MP4）”入口与导出面板：支持极速/精确两种模式、进度展示与取消
  - Tauri 后端新增导出命令：`editor_export_start` / `editor_export_cancel`，使用 FFmpeg sidecar 完成“切片 + 合并”并通过事件回传进度
  - Tauri 配置：启用 `bundle.externalBin` 绑定 `binaries/ffmpeg`，并在 capabilities 中放行 sidecar 执行（仅 ffmpeg）
  - CI：Release workflow 构建前自动下载对应平台 FFmpeg 并放入 `src-tauri/binaries`（macOS x64/arm64 + Windows）
- 原因：补齐剪辑台最核心的“导出成片”能力，并保证 Mac/Windows Tauri 端可用与可取消
- 阻碍因素：无
- 状态：未确认

[2026-02-01 17:25:00]
- 已修改：src/lib/workflow/video.ts src/components/canvas/nodes/VideoConfigNodeFlow.tsx
- 更改：
  - 修复 `veo_3_1-components`（format: `openai-video`）请求 400：不合法的 size
  - 按 Apifox 文档：OpenAI 视频格式 `size` 强制使用像素尺寸（横版 `1280x720` / 竖版 `720x1280`），兼容旧节点残留 `720p`
  - 修复视频配置节点切换到“无 sizes 选项的模型”时，UI 未清理旧 size，导致把 `720p` 误带入请求
- 原因：确保 Veo 3.1 Components 在 Web/Tauri 下都能稳定创建任务，不再被 size 参数拦截
- 阻碍因素：无
- 状态：未确认

[2026-02-01 21:31:13]
- 已修改：src/App.tsx src/routes/Canvas.tsx src/routes/Editor.tsx src/components/canvas/ShortDramaStudioModal.tsx src/components/shortDrama/ShortDramaStudioShell.tsx src/routes/ShortDramaStudioPage.tsx
- 更改：
  - 新增短剧制作全屏页面：`/short-drama/:projectId`（保留草稿/偏好 debounce 保存与卸载 flush）
  - 画布左侧工具栏“短剧制作”改为打开全屏页面（不再使用 Canvas 内 modal 状态）
  - 兼容旧返回：`/canvas/:id?openShortDrama=1` 自动重定向到 `/short-drama/:projectId`（并保留 shotId/videoVariantId 等 query）
  - 剪辑台“返回”改为回到 `/short-drama/:projectId`（不再依赖 openShortDrama 参数）
  - 旧 `ShortDramaStudioModal` 改为复用 `ShortDramaStudioShell`（避免两套保存/flush 逻辑分叉）
- 原因：把短剧制作升级为更适合工作流的全屏页面，同时保持入口在左侧工具栏与跨路由数据稳定性
- 阻碍因素：无
- 状态：未确认

[2026-02-01 21:58:26]
- 已修改：src/lib/shortDrama/ai.ts src/components/shortDrama/ShortDramaStudioAutoView.tsx
- 更改：
  - 自动拆解解析更稳：用“括号配对”提取首个完整 JSON；解析失败时自动重试一次并限制输出 shots 数量（避免截断）
  - 解析失败不再把长片段塞进错误提示；原始返回写入 `analysisRaw`，可在 UI 中展开查看
  - 自动模式补齐“画风与统一要求”编辑（预设/补充/负面/锁定），解决“风格不能自选”
  - Step1 报错块改为可换行 + 限高滚动，修复长错误导致的排版挤压
- 原因：提高自动拆解成功率与可用性，并让风格可控且 UI 更符合 Nexus 的稳定交互
- 阻碍因素：无
- 状态：未确认

[2026-02-01 22:36:15]
- 已修改：src/components/shortDrama/ShortDramaStudioAutoView.tsx
- 更改：
  - 自动模式“分析并搭建”后，自动优先生成一致性素材：角色设定图 + 场景参考图（生成中会提示并禁用后续步骤）
  - “批量生成首/尾”改为仅生成关键帧（不再与角色/场景并发混跑），确保关键帧引用到已生成的角色/场景参考图
  - 增加步骤禁用逻辑：一致性素材/关键帧/视频批量生成互斥，避免用户提前点导致一致性失效
  - 保留“全自动”策略：一致性素材完成后可继续自动生成关键帧（首/尾）
- 原因：把自动流程改为“先角色/场景一致性 → 再首尾关键帧 → 再视频”，解决人物/场景一致性在并发时被削弱的问题
- 阻碍因素：无
- 状态：未确认

[2026-02-01 23:20:56]
- 已修改：src/components/shortDrama/ShortDramaStudioAutoView.tsx
- 更改：
  - 移除“分析并搭建”后的自动续跑关键帧：现在只会自动生成角色/场景一致性参考图，然后停住等待用户确认
  - 更新自动模式说明文案：强调首/尾关键帧与视频必须由用户手动点击触发
- 原因：避免用户尚未确认角色/场景一致性时就自动生成首/尾关键帧，导致一致性偏差与额外消耗
- 阻碍因素：无
- 状态：未确认

[2026-02-01 23:47:42]
- 已修改：src/routes/Editor.tsx src/components/shortDrama/ShortDramaStudioAutoView.tsx src/components/shortDrama/ShortDramaStudioManualView.tsx src/lib/workflow/video.ts
- 更改：
  - 剪辑台：进入/切换片段时自动加载到预览区（不自动播放），并在“返回”前强制保存剪辑工程与停止播放
  - 剪辑台：导出成片完成后，自动把成片（asset://）写入历史素材
  - 短剧自动模式：生成成功的图片/视频同步写入历史素材
  - 短剧自动/手动生图：不再把 dataURL 写入 variant.sourceUrl（仅保留 http(s)），避免草稿 localStorage 因超大字符串保存失败导致“返回后素材消失”
  - 画布视频：生成成功后同步写入历史素材
- 原因：修复剪辑台可用性与返回丢素材问题，并实现“画布/导演台/短剧/剪辑台”全链路历史素材同步
- 阻碍因素：无
- 状态：未确认

[2026-02-03 12:16:12]
- 已修改：src/config/models.js src/lib/workflow/video.ts src/components/canvas/nodes/VideoConfigNodeFlow.tsx src/lib/workflow/klingTool.ts src/lib/shortDrama/generateMedia.ts src/components/shortDrama/ShortDramaStudioAutoView.tsx src/components/shortDrama/ShortDramaStudioManualView.tsx
- 更改：
  - Kling 视频模型补齐与细化：Omni-Video 时长选项扩展（3~10s）；Kling v2.6 支持在视频配置节点填写 voice_id，并在运行时按模型能力正确下发 sound/voice_list
  - Kling 工具节点增强：支持 GET 请求与 text 输出；补齐音色管理（查询/删除/官方音色）等接口配置
  - 短剧工作台视频生成：新增对 kling-multi-image2video / kling-omni-video 的创建与轮询支持，并放开工作台下拉过滤
- 原因：满足“可灵 Kling 平台模型/能力全面性”与短剧制作相关用户反馈（模型能力传参与工作台视频模型支持）
- 阻碍因素：无
- 状态：未确认

[2026-02-03 16:31:28]
- 已修改：src/components/shortDrama/ShortDramaStudioShell.tsx src/components/shortDrama/ShortDramaStudioAutoView.tsx src/components/shortDrama/ShortDramaStudioManualView.tsx src/lib/shortDrama/generateMedia.ts src/lib/assets/syncFromCanvas.ts src/components/shortDrama/ShortDramaMediaPickerModal.tsx package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/tauri.conf.local.json
- 更改：
  - 工作台自动模式新增：图片比例/尺寸、图片画质、视频比例、视频时长、视频清晰度/分辨率选项；切换模型时自动清理不兼容旧值
  - 修复“返回画布后再进工作台回滚/丢操作”：提供同步更新 ref + state 的 setter，flush 保存时始终使用最新草稿；并在落盘失败（localStorage 可能满）时提示一次
  - 修复“短剧工作台视频全报错（画布正常）”：视频生成侧补齐 `asset://` 输入转换为 dataURL，并在 Kling 图生/多图/Omni 视频分支中压缩上传为公网 URL；生成图片时把原始 dataURL 写入 IndexedDB（mediaId），避免后续只剩 asset:// 导致传参失败
  - 历史素材同步优化：从画布同步素材时优先写入 `sourceUrl`；历史素材选择器不再使用本地缓存 URL（避免 127.0.0.1/缓存地址进入下游生成）
  - 发布：版本号升级为 0.1.21，推送并打 tag `v0.1.21` 触发 GitHub Actions 构建发布（Win/Mac）
- 原因：解决短剧工作台“参数可选性/兼容性”、草稿持久化稳定性与视频生成入参不一致导致的报错，并完成 v0.1.21 构建发布
- 阻碍因素：无
- 状态：未确认

# 最终审查
[待验证]

