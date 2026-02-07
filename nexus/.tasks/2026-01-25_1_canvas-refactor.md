# 背景
文件名：2026-01-25_1_canvas-refactor
创建于：2026-01-25_14:30:00
创建者：mac
主分支：main
任务分支：task/canvas-refactor_2026-01-25_1
Yolo模式：Off

# 任务描述
重构 Nexus 画布事件架构，实现事件分层代理模式，引入空间索引优化，解决 pointer-events 交互问题，对齐 huobao-canvas 功能体验。

# 项目概览
- Nexus 是一个基于 React + TypeScript + WebGL 的节点式 AI 创作画布
- 当前 WebGL 层处理所有事件，DOM 节点卡片使用 pointer-events-none
- 需要重构为事件分层代理模式，让 DOM 层接管节点交互

# 分析
见 PLAN 模式的详细规范文档

# 提议的解决方案
三阶段实施：
1. 阶段 1：基础设施（spatialIndex、hitTesting、store 修改）
2. 阶段 2：事件协调层（EventCoordinator 组件）
3. 阶段 3：组件重构（WebGLGraphCanvas、NodeCardsLayer 修改）

# 当前执行步骤："已完成所有阶段"

# 任务进度
[2026-01-25 14:30:00]
- 已修改：.tasks/2026-01-25_1_canvas-refactor.md
- 更改：创建任务文件
- 原因：跟踪任务进度
- 阻碍因素：无
- 状态：成功

[2026-01-25 14:35:00]
- 已修改：src/graph/spatialIndex.ts (新建)
- 更改：创建空间索引模块，实现网格索引、视口查询、索引重建等功能
- 原因：优化节点可见性检测，从 O(n) 降至 O(k)
- 阻碍因素：无
- 状态：成功

[2026-01-25 14:40:00]
- 已修改：src/graph/hitTesting.ts (新建)
- 更改：创建命中检测工具模块，从 WebGLGraphCanvas 提取纯函数
- 原因：代码复用，支持多组件共享命中检测逻辑
- 阻碍因素：无
- 状态：成功

[2026-01-25 14:50:00]
- 已修改：src/graph/store.ts
- 更改：集成空间索引到 Zustand store，在节点 CRUD 操作中维护索引
- 原因：保持空间索引与 store 状态同步
- 阻碍因素：无
- 状态：成功

[2026-01-25 15:00:00]
- 已修改：src/components/canvas/EventCoordinator.tsx (新建)
- 更改：创建统一事件协调层，处理画布/节点/边缘的所有指针事件
- 原因：实现事件分层代理模式，解决 pointer-events 交互问题
- 阻碍因素：无
- 状态：成功

[2026-01-25 15:15:00]
- 已修改：src/components/canvas/WebGLGraphCanvas.tsx
- 更改：添加外部事件系统支持（useExternalEvents prop），支持外部提供的连接预览/框选/对齐线状态
- 原因：支持新事件架构的渐进迁移
- 阻碍因素：无
- 状态：成功

[2026-01-25 15:25:00]
- 已修改：src/components/canvas/NodeCardsLayer.tsx
- 更改：添加空间索引查询支持（useSpatialIndex prop）
- 原因：优化可见性计算性能
- 阻碍因素：无
- 状态：成功

[2026-01-25 15:35:00]
- 已修改：src/routes/Canvas.tsx
- 更改：添加功能开关 USE_NEW_EVENT_SYSTEM 和 USE_SPATIAL_INDEX，集成新组件
- 原因：支持新旧事件系统的切换测试
- 阻碍因素：无
- 状态：成功

# 最终审查
[待验证]
