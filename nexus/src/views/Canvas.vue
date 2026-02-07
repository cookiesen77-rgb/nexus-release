<template>
  <!-- Canvas page | 画布页面 -->
  <div class="h-screen w-screen flex flex-col bg-[var(--bg-primary)]">
    <!-- Header | 顶部导航 -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
      <div class="flex items-center gap-3">
        <button 
          @click="goBack"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
        >
          <n-icon :size="20"><ChevronBackOutline /></n-icon>
        </button>
        <n-dropdown :options="projectOptions" @select="handleProjectAction">
          <button class="flex items-center gap-1 hover:bg-[var(--bg-tertiary)] px-2 py-1 rounded-lg transition-colors">
            <span class="font-medium">{{ projectName }}</span>
            <n-icon :size="16"><ChevronDownOutline /></n-icon>
          </button>
        </n-dropdown>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="toggleRenderMode"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          :class="{ 'text-[var(--accent-color)]': shouldShowGpuOverlay }"
          title="GPU 加速状态（自动切换）"
        >
          <span class="text-xs font-medium">{{ shouldShowGpuOverlay ? 'GPU' : 'DOM' }}</span>
        </button>
        <button 
          @click="toggleTheme"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
        >
          <n-icon :size="20">
            <SunnyOutline v-if="isDark" />
            <MoonOutline v-else />
          </n-icon>
        </button>
        <button
          @click="openPanel('download')"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          :class="{ 'text-[var(--accent-color)]': hasDownloadableAssets }"
          title="批量下载素材"
        >
          <n-icon :size="20"><DownloadOutline /></n-icon>
        </button>
        <button
          @click="openPanel('history', { toggle: true })"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          :class="{ 'text-[var(--accent-color)]': showHistoryPanel }"
          title="历史素材"
        >
          <n-icon :size="20"><TimeOutline /></n-icon>
        </button>
        <button
          @click="openPanel('apiSettings')"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          :class="{ 'text-[var(--accent-color)]': isApiConfigured }"
          title="API 设置"
        >
          <n-icon :size="20"><SettingsOutline /></n-icon>
        </button>
        <button
          @click="openDebugPanel"
          class="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          :class="{ 'text-[var(--accent-color)]': debugEnabled }"
          title="生图调试日志"
        >
          <n-icon :size="20"><BugOutline /></n-icon>
        </button>
        <!-- <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)]">
          <span class="text-[var(--accent-color)]">◆</span>
          <span class="text-sm font-medium">112.00</span>
          <span class="text-xs text-[var(--text-secondary)]">开通会员</span>
        </div> -->
      </div>
    </header>

    <!-- Main canvas area | 主画布区域 -->
    <div
      class="flex-1 relative overflow-hidden"
      @drop="handleCanvasDrop"
      @dragover.prevent
      @dragenter.prevent
    >
      <!-- Vue Flow 始终存在，保证完整交互能力 -->
      <VueFlow
        :key="flowKey"
        v-model:nodes="nodes"
        v-model:edges="edges"
        v-model:viewport="flowViewport"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-viewport="flowViewport"
        :min-zoom="0.1"
        :max-zoom="2"
        :only-render-visible-elements="!cullingDisabled"
        :pan-on-drag="true"
        :pan-on-scroll="true"
        :pan-on-scroll-mode="'free'"
        :zoom-on-scroll="false"
        :zoom-on-pinch="true"
        :select-nodes-on-drag="true"
        :multi-selection-key-code="'Shift'"
        :snap-to-grid="true"
        :snap-grid="[20, 20]"
        :delete-key-code="null"
        @connect="onConnect"
        @node-click="onNodeClick"
        @node-context-menu="onNodeContextMenu"
        @edge-context-menu="onEdgeContextMenu"
        @node-drag-stop="onNodeDragStop"
        @node-drag-start="onNodeDragStart"
        @selection-drag-stop="onNodeDragStop"
        @selection-drag-start="onNodeDragStart"
        @nodes-change="onNodesChange"
        @pane-click="onPaneClick"
        @pane-mouse-move="onPaneMouseMove"
        @viewport-change="onViewportChange"
        @viewport-change-end="onViewportChangeEnd"
        @edges-change="onEdgesChange"
        @selection-change="onSelectionChange"
        :class="['canvas-flow', { 'is-interacting': isCanvasInteracting, 'gpu-overlay-active': shouldShowGpuOverlay }]"
      >
        <Background v-if="showGrid" :gap="20" :size="1" />
        <MiniMap
          v-if="!isMobile"
          position="bottom-right"
          :pannable="true"
          :zoomable="true"
        />
      </VueFlow>

      <!-- GPU 快速预览层：远景/快速交互时自动覆盖，带平滑过渡 -->
      <Transition name="gpu-fade">
        <HighPerfCanvas
          v-if="shouldShowGpuOverlay"
          :viewport="flowViewport"
          :interactive="false"
          :show-hud="showGpuHud"
          class="gpu-overlay-layer"
        />
      </Transition>

      <!-- Floating UI (teleported) | 悬浮 UI（Teleport 到 body，避免被画布 transform/viewport 影响） -->
      <Teleport to="body">
        <!-- Overlay root: fixed + pointer-events strategy to avoid clipping/stacking issues | 悬浮 UI 根容器：固定定位 + 指针事件策略，避免被裁剪/层叠影响 -->
        <div class="nexus-floating-root pointer-events-none">
          <!-- Left toolbar | 左侧工具栏 -->
          <aside class="pointer-events-auto fixed left-4 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-2 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] shadow-lg">
            <button 
              @click="toggleNodeMenu"
              class="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)] transition-colors"
              title="添加节点"
            >
              <n-icon :size="20"><AddOutline /></n-icon>
            </button>
            <button
              @click="openPanel('workflow')"
              class="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
              title="工作流模板"
            >
              <n-icon :size="20"><AppsOutline /></n-icon>
            </button>
            <button
              @click="openPanel('director')"
              class="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
              title="导演台"
            >
              <n-icon :size="20"><VideocamOutline /></n-icon>
            </button>
            <button
              @click="openPanel('sketch')"
              class="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
              title="草图编辑器"
            >
              <n-icon :size="20"><BrushOutline /></n-icon>
            </button>
            <button
              @click="openPanel('sonic')"
              class="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
              title="音频工作室"
            >
              <n-icon :size="20"><MusicalNotesOutline /></n-icon>
            </button>
            <div class="w-full h-px bg-[var(--border-color)] my-1"></div>
            <button 
              v-for="tool in tools" 
              :key="tool.id"
              @click="tool.action"
              :disabled="tool.disabled && tool.disabled()"
              class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              :title="tool.name"
            >
              <n-icon :size="20"><component :is="tool.icon" /></n-icon>
            </button>
          </aside>

          <!-- Node menu popup | 节点菜单弹窗 -->
          <div 
            v-if="showNodeMenu"
            class="pointer-events-auto fixed left-20 top-1/2 -translate-y-1/2 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] shadow-lg p-2"
          >
            <button 
              v-for="nodeType in nodeTypeOptions" 
              :key="nodeType.type"
              @click="addNewNode(nodeType.type)"
              class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors text-left"
            >
              <n-icon :size="20" :color="nodeType.color"><component :is="nodeType.icon" /></n-icon>
              <span class="text-sm">{{ nodeType.name }}</span>
            </button>
          </div>

          <!-- Bottom controls | 底部控制 -->
          <div class="pointer-events-auto fixed bottom-4 left-4 flex items-center gap-2 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] p-1">
            <!-- <button 
              @click="showGrid = !showGrid" 
              :class="showGrid ? 'bg-[var(--accent-color)] text-white' : 'hover:bg-[var(--bg-tertiary)]'"
              class="p-2 rounded transition-colors"
              title="切换网格"
            >
              <n-icon :size="16"><GridOutline /></n-icon>
            </button> -->
            <button 
              @click="fitView({ padding: 0.2 })" 
              class="p-2 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="适应视图"
            >
              <n-icon :size="16"><LocateOutline /></n-icon>
            </button>
            <div class="flex items-center gap-1 px-2">
              <button @click="zoomOut" class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
                <n-icon :size="14"><RemoveOutline /></n-icon>
              </button>
              <span class="text-xs min-w-[40px] text-center">{{ Math.round(canvasViewport.zoom * 100) }}%</span>
              <button @click="zoomIn" class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
                <n-icon :size="14"><AddOutline /></n-icon>
              </button>
            </div>
          </div>

          <!-- Bottom input panel (floating) | 底部输入面板（悬浮） -->
          <template v-if="!assistantCollapsed">
            <div
              class="pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 w-full px-4"
              :class="autoExecute ? 'max-w-2xl' : 'max-w-4xl'"
            >
              <!-- Processing indicator | 处理中指示器 -->
              <div
                v-if="isProcessing"
                class="mb-3 p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--accent-color)] animate-pulse"
              >
                <div class="flex items-center gap-2 text-sm text-[var(--accent-color)] mb-2">
                  <n-spin :size="14" />
                  <span>{{ processingLabel }}</span>
                </div>
                <div v-if="currentResponse" class="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                  {{ currentResponse }}
                </div>
              </div>

              <div class="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-color)] p-3">
                <div
                  ref="chatHistoryRef"
                  class="relative mb-3 max-h-[55vh] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]/40 p-3 select-text"
                  @scroll="handleChatHistoryScroll"
                  @mousedown.stop
                  @pointerdown.stop
                  @touchstart.stop
                >
                  <div v-if="!chatMessages.length" class="text-sm text-[var(--text-secondary)] leading-relaxed">
                    <div class="font-medium text-[var(--text-primary)] mb-1">AI 助手</div>
                    <div>像 ChatGPT 一样聊天：回车发送、Shift+回车换行。</div>
                    <div class="mt-1" v-if="autoExecute">当前为“自动执行”模式：发送会创建工作流；如需纯聊天，请关闭“自动执行”。</div>
                  </div>

                  <div v-else class="flex flex-col gap-3">
                    <div
                      v-for="msg in chatMessages"
                      :key="msg.id"
                      class="flex"
                      :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
                    >
                      <div
                        class="max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words"
                        :class="msg.role === 'user'
                          ? 'bg-[var(--accent-color)] text-white'
                          : 'bg-[var(--bg-primary)] text-[var(--text-primary)] border border-[var(--border-color)]'"
                      >
                        <div v-if="msg.role !== 'user'" class="text-[11px] text-[var(--text-secondary)] mb-1">AI</div>
                        <div v-else class="text-[11px] text-white/80 mb-1">你</div>
                        <div>{{ msg.content }}</div>
                        <div v-if="msg.streaming" class="mt-1 text-[11px] opacity-70">正在输入…</div>
                      </div>
                    </div>
                  </div>

                  <button
                    v-if="showScrollToBottom"
                    @click="scrollChatToBottom(true)"
                    class="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-md hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center"
                    title="回到底部"
                  >
                    <n-icon :size="18"><ChevronDownOutline /></n-icon>
                  </button>
                </div>
                <textarea
                  v-model="chatInput"
                  ref="chatInputRef"
                  :placeholder="inputPlaceholder"
                  :disabled="isProcessing"
                  class="w-full bg-transparent resize-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] disabled:opacity-50 select-text cursor-text"
                  :class="autoExecute ? 'min-h-[40px] max-h-[120px]' : 'min-h-[100px] max-h-[320px]'"
                  rows="1"
                  @input="autoResizeChatInput"
                  @keydown.enter.exact="handleEnterKey"
                  @keydown.enter.ctrl="sendMessage"
                  @mousedown.stop
                  @pointerdown.stop
                  @touchstart.stop
                />
                <div v-if="chatAttachments.length" class="mt-2 flex flex-wrap gap-2">
                  <div
                    v-for="att in chatAttachments"
                    :key="att.id"
                    class="relative w-16 h-16 rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)]"
                    title="参考图（将作为生成参考输入）"
                  >
                    <img v-if="att.previewUrl" :src="att.previewUrl" class="w-full h-full object-cover" />
                    <button
                      @click="removeAttachment(att.id)"
                      class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                      title="移除"
                    >
                      ×
                    </button>
                  </div>
                </div>
                <div class="flex items-center justify-between mt-2">
                  <div class="flex items-center gap-2">
                    <label
                      class="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-colors cursor-pointer"
                      :class="isProcessing ? 'opacity-50 cursor-not-allowed' : ''"
                      title="上传参考图"
                    >
                      🖼️ 上传参考图
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        class="hidden"
                        :disabled="isProcessing"
                        @change="handleAttachmentUpload"
                      />
                    </label>
                    <button
                      @click="handlePolish"
                      :disabled="isProcessing || !chatInput.trim()"
                      class="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="AI 润色提示词"
                    >
                      ✨ AI 润色
                    </button>
                    <button
                      @click="openPanel('promptLibrary')"
                      :disabled="isProcessing"
                      class="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="打开提示词库"
                    >
                      📚 提示词库
                    </button>
                  </div>
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <n-switch v-model:value="autoExecute" size="small" />
                      自动执行
                    </label>
                    <label v-if="!autoExecute" class="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <n-switch v-model:value="enableWebSearch" size="small" />
                      联网搜索
                    </label>
                    <label v-if="!autoExecute" class="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <n-switch v-model:value="memoryEnabled" size="small" />
                      记忆
                    </label>
                    <button
                      v-if="!autoExecute && (memorySummary || '').length"
                      @click="clearAssistantMemory"
                      class="px-2 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-colors"
                      title="清空长期记忆"
                    >
                      清空记忆
                    </button>
                    <button
                      v-if="!autoExecute && chatMessages.length"
                      @click="clearChatHistory"
                      class="px-2 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] border border-[var(--border-color)] transition-colors"
                    >
                      清空对话
                    </button>
                    <button
                      @click="assistantCollapsed = true"
                      class="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
                      title="收起 AI 助手"
                    >
                      <n-icon :size="16"><ChevronDownOutline /></n-icon>
                    </button>
                    <button
                      @click="sendMessage"
                      :disabled="isProcessing"
                      class="w-8 h-8 rounded-xl bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <n-spin v-if="isProcessing" :size="16" />
                      <n-icon v-else :size="20" color="white"><SendOutline /></n-icon>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Quick suggestions | 快捷建议 -->
              <div class="flex flex-wrap items-center justify-center gap-2 mt-2">
                <span class="text-xs text-[var(--text-secondary)]">推荐：</span>
                <button
                  v-for="tag in suggestions"
                  :key="tag"
                  @click="chatInput = tag"
                  class="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-secondary)]/80 border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                >
                  {{ tag }}
                </button>
                <button class="p-1 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors">
                  <n-icon :size="14"><RefreshOutline /></n-icon>
                </button>
              </div>
            </div>
          </template>

          <!-- AI assistant wake button | AI 助手唤出按钮 -->
          <template v-else>
            <button
              @click="assistantCollapsed = false"
              class="pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              title="唤出 AI 助手"
            >
              <n-icon :size="18"><ChatbubblesOutline /></n-icon>
              <span class="text-sm">AI 助手</span>
            </button>
          </template>
        </div>
      </Teleport>
    </div>

    <!-- API Settings Modal | API 设置弹窗 -->
    <ApiSettings v-model:show="showApiSettings" />
    <PromptLibraryModal v-model:show="showPromptLibrary" @insert="handlePromptInsert" />

    <!-- Rename Modal | 重命名弹窗 -->
    <n-modal v-model:show="showRenameModal" preset="dialog" title="重命名项目">
      <n-input v-model:value="renameValue" placeholder="请输入项目名称" />
      <template #action>
        <n-button @click="showRenameModal = false">取消</n-button>
        <n-button type="primary" @click="confirmRename">确定</n-button>
      </template>
    </n-modal>

    <!-- Delete Confirm Modal | 删除确认弹窗 -->
    <n-modal v-model:show="showDeleteModal" preset="dialog" title="删除项目" type="warning">
      <p>确定要删除项目「{{ projectName }}」吗？此操作不可恢复。</p>
      <template #action>
        <n-button @click="showDeleteModal = false">取消</n-button>
        <n-button type="error" @click="confirmDelete">删除</n-button>
      </template>
    </n-modal>

    <!-- Debug Modal | 调试日志弹窗 -->
    <n-modal
      v-model:show="showDebugPanel"
      preset="card"
      title="生图调试日志"
      :style="{ width: '760px', maxWidth: '92vw' }"
    >
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs text-[var(--text-secondary)]">
            状态：{{ debugEnabled ? '已开启' : '未开启' }}
          </div>
          <div class="flex items-center gap-2">
            <n-button size="small" @click="toggleDebugLogging">
              {{ debugEnabled ? '关闭采集' : '开启采集' }}
            </n-button>
            <n-button size="small" @click="refreshDebugLogs">刷新</n-button>
            <n-button size="small" @click="copyDebugLogs">复制</n-button>
            <n-button size="small" @click="clearDebugLogs">清空</n-button>
          </div>
        </div>
        <div class="text-[11px] text-[var(--text-secondary)]">
          仅记录生图相关请求与轮询响应（已脱敏）。若无内容，请先开启采集并复现一次。
        </div>
        <div class="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
          <pre class="text-[11px] leading-4 whitespace-pre-wrap">{{ debugText }}</pre>
        </div>
      </div>
    </n-modal>

    <!-- Download Modal | 下载弹窗 -->
    <DownloadModal v-model:show="showDownloadModal" />

    <!-- Workflow Panel | 工作流面板 -->
    <WorkflowPanel v-model:show="showWorkflowPanel" @add-workflow="handleAddWorkflow" />

    <!-- History Panel | 历史素材面板 -->
    <Transition name="slide-right">
      <div
        v-if="showHistoryPanel"
        class="fixed right-0 top-0 h-full w-72 z-[1200] shadow-lg"
      >
        <HistoryPanel
          @close="showHistoryPanel = false"
          @add-to-canvas="handleHistoryAddToCanvas"
        />
      </div>
    </Transition>

    <!-- Director Console | 导演台 -->
    <DirectorConsole
      v-model:show="showDirectorConsole"
      @create-nodes="handleDirectorCreateNodes"
    />

    <!-- Sketch Editor | 草图编辑器 -->
    <SketchEditor
      v-model:show="showSketchEditor"
      @generate="handleSketchGenerate"
    />

    <!-- Sonic Studio | 音频工作室 -->
    <SonicStudio
      v-model:show="showSonicStudio"
      @generated="handleSonicGenerated"
      @add-to-canvas="handleSonicAddToCanvas"
      @insert-lyrics="handleLyricsInsert"
    />

    <!-- Clarification Modal | 澄清对话框 -->
    <n-modal
      v-model:show="showClarificationModal"
      preset="card"
      title="🤔 需要补充一些信息"
      style="width: 500px; max-width: 90vw;"
      :mask-closable="false"
    >
      <div class="space-y-4">
        <p class="text-[var(--text-secondary)] text-sm">{{ clarificationContext }}</p>

        <div v-for="(q, idx) in clarificationQuestions" :key="q.key" class="space-y-2">
          <label class="block text-sm font-medium">{{ q.question }}</label>

          <!-- Options as radio buttons | 选项作为单选按钮 -->
          <template v-if="q.options && q.options.length > 0">
            <n-space vertical>
              <n-radio-group v-model:value="clarificationAnswers[q.key]">
                <n-space vertical>
                  <n-radio
                    v-for="opt in q.options"
                    :key="opt"
                    :value="opt"
                    :label="opt"
                  />
                </n-space>
              </n-radio-group>
              <!-- Custom input for "其他" option | "其他"选项的自定义输入 -->
              <n-input
                v-if="clarificationAnswers[q.key] && String(clarificationAnswers[q.key]).includes('其他')"
                v-model:value="clarificationAnswers[`${q.key}_custom`]"
                placeholder="请输入自定义内容"
                size="small"
                class="mt-2"
              />
            </n-space>
          </template>

          <!-- Text input for open questions | 开放问题的文本输入 -->
          <template v-else>
            <n-input
              v-model:value="clarificationAnswers[q.key]"
              type="textarea"
              :rows="2"
              :placeholder="'请输入' + (q.question || '').replace(/[？?]/g, '')"
            />
          </template>
        </div>
      </div>

      <template #footer>
        <n-space justify="end">
          <n-button @click="handleClarificationSkip" quaternary>跳过，直接生成</n-button>
          <n-button type="primary" @click="handleClarificationSubmit">确认补充</n-button>
        </n-space>
      </template>
    </n-modal>

    <!-- Context Menu | 右键菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.show"
        class="fixed inset-0 z-[1300]"
        @click="closeContextMenu"
        @contextmenu.prevent="closeContextMenu"
      >
        <n-dropdown
          :show="contextMenu.show"
          :x="contextMenu.x"
          :y="contextMenu.y"
          :options="contextMenu.type === 'node' ? nodeContextMenuOptions : edgeContextMenuOptions"
          @select="handleContextMenuAction"
          placement="bottom-start"
          trigger="manual"
          @click.stop
        />
      </div>
    </Teleport>
  </div>
</template>

<script setup>
/**
 * Canvas view component | 画布视图组件
 * Main infinite canvas with Vue Flow integration
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick, markRaw, h } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { NIcon, NSwitch, NDropdown, NMessageProvider, NSpin, NModal, NInput, NButton, NRadioGroup, NRadio, NSpace } from 'naive-ui'
import {
  ChevronBackOutline,
  ChevronDownOutline,
  SunnyOutline,
  MoonOutline,
  SettingsOutline,
  AddOutline,
  ImageOutline,
  SendOutline,
  RefreshOutline,
  TextOutline,
  VideocamOutline,
  ColorPaletteOutline,
  BookmarkOutline,
  ArrowUndoOutline,
  ArrowRedoOutline,
  GridOutline,
  LocateOutline,
  RemoveOutline,
  DownloadOutline,
  BugOutline,
  AppsOutline,
  ChatbubblesOutline,
  LinkOutline,
  TimeOutline,
  CopyOutline,
  TrashOutline,
  BrushOutline,
  MusicalNotesOutline,
  SaveOutline
} from '@vicons/ionicons5'
import { isDark, toggleTheme } from '../stores/theme'
import { nodes, edges, addNode, addEdge, updateNode, updateEdge as updateCanvasEdge, initSampleData, loadProject, saveProject, clearCanvas, canvasViewport, updateViewport, cullingDisabled, undo, redo, canUndo, canRedo, manualSaveHistory, scheduleProjectSave, duplicateNode, removeNode, removeEdge, pruneDanglingEdges, withBatchUpdates, getNextZIndex } from '../stores/canvas'
import { loadAllModels } from '../stores/models'
import { useApiConfig, useChat, usePolish, useWorkflowOrchestrator } from '../hooks'
import { projects, initProjectsStore, updateProject, renameProject, currentProject } from '../stores/projects'
import { addAsset } from '../stores/assets'

// API Settings component | API 设置组件
import ApiSettings from '../components/ApiSettings.vue'
import DownloadModal from '../components/DownloadModal.vue'
import WorkflowPanel from '../components/WorkflowPanel.vue'
import PromptLibraryModal from '../components/PromptLibraryModal.vue'
import HistoryPanel from '../components/HistoryPanel.vue'
import DirectorConsole from '../components/DirectorConsole.vue'
import SketchEditor from '../components/SketchEditor.vue'
import SonicStudio from '../components/SonicStudio.vue'

// API Config hook | API 配置 hook
const { isConfigured: isApiConfigured } = useApiConfig()

// Initialize models on page load | 页面加载时初始化模型
onMounted(() => {
  loadAllModels()
  loadMemory()
  loadRenderMode()
  try {
    const saved = localStorage.getItem(CHAT_MEMORY_ENABLED_KEY)
    if (saved !== null) memoryEnabled.value = saved === '1'
  } catch {
    // ignore
  }
  try {
    assistantCollapsed.value = localStorage.getItem(ASSISTANT_COLLAPSED_KEY) === '1'
  } catch {
    assistantCollapsed.value = false
  }
  syncDebugEnabled()
})

// AI polish hook | AI 润色（上下文增强）
const { preview: currentResponse, polish } = usePolish()
const ASSISTANT_SYSTEM_PROMPT = `你是 Nexus 的万能导演编剧与商业创意助手，精通电影、动画、分镜、角色设定、剧情创作、品牌与电商产品创作。
回答要求：
- 默认使用中文，风格清晰、专业、可执行。
- 不展示思考过程、推理步骤或内部分析；只输出结论和可用内容。
- 除非用户明确要求，否则不要输出代码或工具细节。
- 信息不足时先提出 1-3 个关键澄清问题。
- 当用户开启“联网搜索”，遇到实时/事实类问题需先检索再答，返回简洁结论。`

import { buildChatMessages } from '@/utils'
import { loadMemory, searchMemory, addMemoryItem, clearMemory, memorySummary, memoryItems, setMemorySummary } from '@/stores/memory'

const CHAT_MEMORY_ENABLED_KEY = 'nexus-chat-memory-enabled'
const memoryEnabled = ref(true)

const buildCanvasContextForChat = (nodesList, focusId) => {
  const list = Array.isArray(nodesList) ? nodesList : []
  const focus = focusId ? list.find(n => n?.id === focusId) : null

  const textNodes = list
    .filter(n => n?.type === 'text' && n?.data?.content)
    .map(n => ({ n, t: Number(n.data?.updatedAt || n.data?.createdAt || 0) }))
    .sort((a, b) => b.t - a.t)
    .map(x => x.n)

  const merged = []
  const seen = new Set()
  if (focus?.type === 'text') {
    merged.push(focus)
    seen.add(focus.id)
  }
  for (const n of textNodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    merged.push(n)
    if (merged.length >= 6) break
  }

  const lines = []
  let used = 0
  for (const n of merged) {
    const label = String(n.data?.label || '文本节点').trim()
    const content = String(n.data?.content || '').trim()
    if (!content) continue
    const snippet = content.length > 380 ? `${content.slice(0, 380)}…` : content
    const next = `- ${label}: ${snippet}`
    if (used + next.length > 1400) break
    lines.push(next)
    used += next.length
  }
  return lines.join('\n')
}

const extractMemoriesHeuristic = (text) => {
  const t = String(text || '').trim()
  if (!t) return []
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
  const hits = []
  for (const line of lines) {
    if (
      /^(我|咱|我们).{0,10}(喜欢|不喜欢|偏好|讨厌|要|不要|希望|习惯)/.test(line) ||
      /(请记住|记住|以后|从现在开始|长期)/.test(line) ||
      /(叫我|我的名字|我叫)/.test(line)
    ) {
      hits.push(line.slice(0, 200))
    }
  }
  return hits.slice(0, 6)
}

const ensureMemorySummary = () => {
  if (!memoryEnabled.value) return
  if (String(memorySummary.value || '').trim().length >= 32) return
  const top = (memoryItems.value || []).slice(0, 10).map(i => i?.content).filter(Boolean)
  if (top.length === 0) return
  setMemorySummary(top.join('；').slice(0, 360))
}

const {
  messages: chatMessages,
  currentResponse: chatResponse,
  status: chatStatus,
  send: sendChat,
  clear: clearChat,
  append: appendChat
} = useChat({
  model: 'gpt-5.1-thinking-all',
  systemPrompt: ASSISTANT_SYSTEM_PROMPT,
  buildMessages: async ({ content, messages, systemPrompt }) => {
    const canvasContext = buildCanvasContextForChat(nodes.value, focusedTextNodeId.value)
    const config = {
      maxChars: 12000,
      maxHistory: 18,
      maxMemoryItems: 6,
      maxMemoryChars: 1200,
      maxCanvasChars: 1200,
      maxSummaryChars: 600
    }

    const tryTauriInvoke = async (command, payload) => {
      try {
        const { isTauri, invoke } = await import('@tauri-apps/api/core')
        if (!isTauri()) return { ok: false }
        const res = await invoke(command, payload)
        return { ok: true, res }
      } catch (err) {
        return { ok: false, err }
      }
    }

    const memoryPayload = memoryEnabled.value
      ? { summary: memorySummary.value, items: memoryItems.value || [] }
      : { summary: '', items: [] }

    // 记忆检索（Rust/Tauri 优先，Web 回退 JS）| Memory retrieval (prefer Rust on desktop)
    let selectedMemoryItems = []
    if (memoryEnabled.value) {
      const tauriRes = await tryTauriInvoke('search_memory', {
        query: content,
        items: memoryPayload.items,
        limit: 6,
        minScore: 0.12
      })
      selectedMemoryItems = tauriRes.ok ? (tauriRes.res || []) : searchMemory(content, { limit: 6 })
    }

    // 上下文拼装（Rust/Tauri 优先，Web 回退 JS）| Context engineering (prefer Rust on desktop)
    const tauriMsgs = await tryTauriInvoke('build_chat_messages', {
      userText: content,
      systemPrompt,
      conversation: (messages || []).map(m => ({ role: m.role, content: m.content })),
      memorySummary: memoryPayload.summary,
      memoryItems: selectedMemoryItems,
      canvasContext,
      config
    })
    if (tauriMsgs.ok && Array.isArray(tauriMsgs.res) && tauriMsgs.res.length > 0) {
      return tauriMsgs.res
    }

    return buildChatMessages({
      userText: content,
      systemPrompt,
      conversation: (messages || []).map(m => ({ role: m.role, content: m.content })),
      memory: { summary: memoryPayload.summary, items: selectedMemoryItems },
      canvasContext,
      config
    })
  }
})

// Workflow orchestrator hook | 工作流编排 hook
const {
  isAnalyzing: workflowAnalyzing,
  isExecuting: workflowExecuting,
  currentStep: workflowStep,
  totalSteps: workflowTotalSteps,
  executionLog: workflowLog,
  analyzeIntent,
  executeWorkflow,
  createTextToImageWorkflow,
  createMultiAngleStoryboard,
  WORKFLOW_TYPES
} = useWorkflowOrchestrator()

// Custom node components | 自定义节点组件
import TextNode from '../components/nodes/TextNode.vue'
import ImageConfigNode from '../components/nodes/ImageConfigNode.vue'
import VideoNode from '../components/nodes/VideoNode.vue'
import ImageNode from '../components/nodes/ImageNode.vue'
import VideoConfigNode from '../components/nodes/VideoConfigNode.vue'
import AudioNode from '../components/nodes/AudioNode.vue'
import LocalSaveNode from '../components/nodes/LocalSaveNode.vue'
import ImageRoleEdge from '../components/edges/ImageRoleEdge.vue'
import HighPerfCanvas from '../components/HighPerfCanvas.vue'

const router = useRouter()
const route = useRoute()

// Vue Flow instance | Vue Flow 实例
const { zoomIn, zoomOut, fitView, updateNodeInternals, screenToFlowCoordinate, updateEdge } = useVueFlow()

// Register custom node types | 注册自定义节点类型
const nodeTypes = {
  text: markRaw(TextNode),
  imageConfig: markRaw(ImageConfigNode),
  video: markRaw(VideoNode),
  image: markRaw(ImageNode),
  videoConfig: markRaw(VideoConfigNode),
  audio: markRaw(AudioNode),
  localSave: markRaw(LocalSaveNode)
}

// Register custom edge types | 注册自定义边类型
const edgeTypes = {
  imageRole: markRaw(ImageRoleEdge)
}

// UI state | UI状态
const showNodeMenu = ref(false)
const chatInput = ref('')
const chatInputRef = ref(null)
const chatAttachments = ref([])
const autoExecute = ref(true)
const isMobile = ref(false)
const showGrid = ref(true)
const showApiSettings = ref(false)
const showPromptLibrary = ref(false)
const isProcessing = ref(false)
const assistantCollapsed = ref(false)
const focusedTextNodeId = ref(null)
const lastMousePosition = ref(null)
const batchConnectMode = ref(false)
const batchConnectSources = ref([])
let mouseMoveRaf = 0
let pendingMouseEvent = null

const ASSISTANT_COLLAPSED_KEY = 'nexus-ai-assistant-collapsed'

// Flow key for forcing re-render on project switch | 项目切换时强制重新渲染的 key
const flowKey = ref(Date.now())
const flowViewport = ref({ x: 100, y: 50, zoom: 0.8 })

// ========== 智能 GPU 覆盖层系统 ==========
// GPU 层在以下情况自动启用：远景、快速交互、大量节点交互时
const GPU_ZOOM_THRESHOLD = 0.35  // 缩放小于此值时启用 GPU 覆盖
const GPU_NODE_THRESHOLD = 200   // 节点数超过此值且交互时启用 GPU 覆盖
const GPU_FADE_DELAY = 180       // 停止交互后延迟隐藏 GPU 层（ms）

const isRapidInteraction = ref(false)  // 是否正在快速交互
const gpuOverlayLocked = ref(false)    // GPU 覆盖层锁定（延迟隐藏）
const showGpuHud = ref(false)          // 是否显示 GPU HUD 信息
let gpuFadeTimer = null

// 计算是否应该显示 GPU 覆盖层
const shouldShowGpuOverlay = computed(() => {
  const zoom = flowViewport.value?.zoom || 1
  const nodeCount = nodes.value?.length || 0

  // 条件1：远景模式（缩放很小，节点细节看不清）
  if (zoom < GPU_ZOOM_THRESHOLD) {
    return true
  }

  // 条件2：大量节点 + 正在交互
  if (nodeCount > GPU_NODE_THRESHOLD && (isCanvasInteracting.value || gpuOverlayLocked.value)) {
    return true
  }

  // 条件3：快速交互中（平移/缩放速度快）
  if (isRapidInteraction.value || gpuOverlayLocked.value) {
    return true
  }

  return false
})

// 标记快速交互开始
const markRapidInteraction = () => {
  isRapidInteraction.value = true
  gpuOverlayLocked.value = true

  if (gpuFadeTimer) clearTimeout(gpuFadeTimer)
  gpuFadeTimer = setTimeout(() => {
    isRapidInteraction.value = false
    gpuOverlayLocked.value = false
  }, GPU_FADE_DELAY)
}

// ========== 旧的渲染模式代码（保留兼容但不再使用手动切换） ==========
const RENDER_MODE_KEY = 'nexus-render-mode-v1'
const RENDER_MODE_USER_KEY = 'nexus-render-mode-user-v1'
const renderMode = ref('auto')  // 'auto' | 'gpu-only' | 'dom-only'

const loadRenderMode = () => {
  // 新版本默认使用 auto 模式
}

const persistRenderMode = () => {
  // 新版本不再需要持久化
}

const isRenderModePinnedByUser = () => false

const maybeAutoSwitchRenderMode = () => {
  // 新版本由 shouldShowGpuOverlay 自动处理
}

const toggleRenderMode = () => {
  // 切换 HUD 显示（调试用）
  showGpuHud.value = !showGpuHud.value
}

// Modal state | 弹窗状态
const showRenameModal = ref(false)
const showDeleteModal = ref(false)
const showDownloadModal = ref(false)
const showWorkflowPanel = ref(false)
const showHistoryPanel = ref(false)
const showDirectorConsole = ref(false)
const showSketchEditor = ref(false)
const showSonicStudio = ref(false)
const showDebugPanel = ref(false)
const debugEnabled = ref(false)
const debugText = ref('')
const isDragging = ref(false)
const isCanvasInteracting = ref(false)
let interactionTimer = null
const renameValue = ref('')
const enableWebSearch = ref(false)
const chatHistoryRef = ref(null)
const isChatAtBottom = ref(true)
const showScrollToBottom = computed(() => !isChatAtBottom.value && chatMessages.value.length > 0)

// Clarification dialog state | 澄清对话框状态
const showClarificationModal = ref(false)
const clarificationContext = ref('')
const clarificationQuestions = ref([])
const clarificationAnswers = ref({})
const pendingWorkflowResult = ref(null)
const pendingWorkflowPosition = ref(null)
const originalUserInput = ref('')

// Check if has downloadable assets | 检查是否有可下载素材
const hasDownloadableAssets = ref(false)

const panelRefs = {
  apiSettings: showApiSettings,
  promptLibrary: showPromptLibrary,
  download: showDownloadModal,
  workflow: showWorkflowPanel,
  history: showHistoryPanel,
  director: showDirectorConsole,
  sketch: showSketchEditor,
  sonic: showSonicStudio,
  debug: showDebugPanel
}

const closeAllPanels = (exceptKey = null) => {
  Object.entries(panelRefs).forEach(([key, refVal]) => {
    if (key === exceptKey) return
    refVal.value = false
  })
  showNodeMenu.value = false
  contextMenu.value.show = false
}

const openPanel = (key, { toggle = false } = {}) => {
  const target = panelRefs[key]
  if (!target) return
  const wasOpen = !!target.value
  closeAllPanels()
  // 打开任意面板时默认收起 AI 助手，避免层叠遮挡（可通过右侧“AI 助手”按钮再唤出）
  assistantCollapsed.value = true
  if (toggle && wasOpen) return
  target.value = true
}

const toggleNodeMenu = () => {
  const next = !showNodeMenu.value
  closeAllPanels()
  assistantCollapsed.value = true
  showNodeMenu.value = next
}

const processingLabel = computed(() => {
  if (!autoExecute.value) return 'AI 回复中...'
  if (currentResponse.value) return '正在生成提示词...'
  return '正在分析工作流...'
})

const updateChatBottomState = () => {
  const el = chatHistoryRef.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  isChatAtBottom.value = distance < 80
}

const scrollChatToBottom = async (force = false) => {
  if (!chatHistoryRef.value) return
  await nextTick()
  if (!chatHistoryRef.value) return
  if (!force && !isChatAtBottom.value) return
  chatHistoryRef.value.scrollTop = chatHistoryRef.value.scrollHeight
  isChatAtBottom.value = true
}

watch(assistantCollapsed, (val) => {
  try {
    localStorage.setItem(ASSISTANT_COLLAPSED_KEY, val ? '1' : '0')
  } catch {
    // ignore
  }
  if (!val) scrollChatToBottom(true)
})

watch(autoExecute, (val) => {
  if (val) enableWebSearch.value = false
})

watch(memoryEnabled, (val) => {
  try {
    localStorage.setItem(CHAT_MEMORY_ENABLED_KEY, val ? '1' : '0')
  } catch {
    // ignore
  }
})

watch(
  () => {
    const last = chatMessages.value[chatMessages.value.length - 1]
    return `${chatMessages.value.length}:${last?.id || ''}:${(last?.content || '').length}:${last?.streaming ? '1' : '0'}`
  },
  () => {
    if (assistantCollapsed.value) return
    scrollChatToBottom()
  }
)


// Project info | 项目信息
const projectName = computed(() => {
  const project = projects.value.find(p => p.id === route.params.id)
  return project?.name || '未命名项目'
})

// Project dropdown options | 项目下拉选项
const projectOptions = [
  { label: '重命名', key: 'rename' },
  { label: '复制', key: 'duplicate' },
  { label: '删除', key: 'delete' },
  { label: '性能压测：生成 5000 节点', key: 'bench-5k' }
]

// Toolbar tools | 工具栏工具
const selectedNodeCount = ref(0)

// 选择变化处理（通过 VueFlow 组件事件触发）
const onSelectionChange = ({ nodes: selectedNodes }) => {
  selectedNodeCount.value = selectedNodes?.length || 0
}

// 只在节点数组变化时检查可下载资源（浅层 watch）
const updateDownloadableAssets = () => {
  let downloadable = false
  for (const n of nodes.value) {
    if ((n?.type === 'image' || n?.type === 'video' || n?.type === 'audio') && n?.data?.url) {
      downloadable = true
      break
    }
  }
  hasDownloadableAssets.value = downloadable
}

watch(nodes, updateDownloadableAssets)

const handleChatHistoryScroll = () => {
  updateChatBottomState()
}

const clearAssistantMemory = () => {
  clearMemory()
  window.$message?.success('长期记忆已清空')
}

const startBatchConnect = () => {
  if (selectedNodeCount.value < 2) {
    window.$message?.warning('请先按住 Shift 框选或多选至少两个节点')
    return
  }
  batchConnectSources.value = nodes.value.filter(n => n.selected).map(n => n.id)
  batchConnectMode.value = true
  window.$message?.info('已进入统一连接模式，请点击目标节点')
}

const cancelBatchConnect = (silent = false) => {
  if (!batchConnectMode.value) return
  batchConnectMode.value = false
  batchConnectSources.value = []
  if (!silent) {
    window.$message?.info('已取消统一连接')
  }
}

const handleBatchConnectTarget = (targetId) => {
  const sources = batchConnectSources.value.filter(id => id !== targetId)
  if (!sources.length) {
    cancelBatchConnect(true)
    window.$message?.warning('请选择一个未被框选的目标节点')
    return
  }

  const existingKeys = new Set(
    edges.value.map(edge => `${edge.source}|${edge.target}|${edge.sourceHandle || ''}|${edge.targetHandle || ''}`)
  )
  let created = 0

  sources.forEach((sourceId) => {
    const key = `${sourceId}|${targetId}|right|left`
    if (existingKeys.has(key)) return
    onConnect({
      source: sourceId,
      target: targetId,
      sourceHandle: 'right',
      targetHandle: 'left'
    })
    existingKeys.add(key)
    created += 1
  })

  batchConnectMode.value = false
  batchConnectSources.value = []

  if (created > 0) {
    window.$message?.success(`已创建 ${created} 条连接`)
  } else {
    window.$message?.info('连接已存在，无需重复创建')
  }
}

const tools = [
  { id: 'text', name: '文本', icon: TextOutline, action: () => addNewNode('text') },
  { id: 'image', name: '图片', icon: ImageOutline, action: () => addNewNode('image') },
  { id: 'imageConfig', name: '文生图', icon: ColorPaletteOutline, action: () => addNewNode('imageConfig') },
  { id: 'localSave', name: '本地保存', icon: SaveOutline, action: () => addNewNode('localSave') },
  { id: 'connect', name: '统一连接', icon: LinkOutline, action: () => startBatchConnect() },
  { id: 'undo', name: '撤销', icon: ArrowUndoOutline, action: () => undo(), disabled: () => !canUndo() },
  { id: 'redo', name: '重做', icon: ArrowRedoOutline, action: () => redo(), disabled: () => !canRedo() }
]

// Node type options for menu | 节点类型菜单选项
const nodeTypeOptions = [
  { type: 'text', name: '文本节点', icon: TextOutline, color: '#3b82f6' },
  { type: 'imageConfig', name: '文生图配置', icon: ColorPaletteOutline, color: '#22c55e' },
  { type: 'videoConfig', name: '视频生成配置', icon: VideocamOutline, color: '#f59e0b' },
  { type: 'image', name: '图片节点', icon: ImageOutline, color: '#8b5cf6' },
  { type: 'video', name: '视频节点', icon: VideocamOutline, color: '#ef4444' },
  { type: 'audio', name: '音频节点', icon: MusicalNotesOutline, color: '#0ea5e9' },
  { type: 'localSave', name: '本地保存', icon: SaveOutline, color: '#0f766e' }
]

// Input placeholder | 输入占位符
const inputPlaceholder = '你可以试着说"帮我生成一个二次元的卡通角色"'

// Quick suggestions | 快捷建议
const suggestions = [
  '像个魔法森林',
  '三只不同的小猫',
  '生成多角度分镜',
  '夏日田野环绕漫步'
]

// Add new node | 添加新节点
const getViewportCenter = () => {
  const viewportCenterX = -canvasViewport.value.x / canvasViewport.value.zoom + (window.innerWidth / 2) / canvasViewport.value.zoom
  const viewportCenterY = -canvasViewport.value.y / canvasViewport.value.zoom + (window.innerHeight / 2) / canvasViewport.value.zoom
  return { x: viewportCenterX, y: viewportCenterY }
}

const getSpawnPosition = (event) => {
  if (event?.clientX != null && event?.clientY != null && screenToFlowCoordinate) {
    const pos = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    lastMousePosition.value = pos
    return pos
  }
  if (lastMousePosition.value) return { x: lastMousePosition.value.x, y: lastMousePosition.value.y }
  return getViewportCenter()
}

const addNewNode = async (type, event) => {
  const spawnPosition = getSpawnPosition(event)
  // Add node at mouse position | 在鼠标位置添加节点
  const nodeId = addNode(type, { x: spawnPosition.x - 100, y: spawnPosition.y - 100 })
  
  // Set highest z-index (clamped) | 设置最高层级（避免超过悬浮 UI 的层级）
  updateNode(nodeId, { zIndex: getNextZIndex() })
  
  // Force Vue Flow to recalculate node dimensions | 强制 Vue Flow 重新计算节点尺寸
  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)
  
  showNodeMenu.value = false
}

// Handle add workflow from panel | 处理从面板添加工作流
const handleAddWorkflow = ({ workflow, options }) => {
  const spawnPosition = getSpawnPosition()
  // Create nodes from workflow template | 从工作流模板创建节点
  const startPosition = { x: spawnPosition.x - 300, y: spawnPosition.y - 200 }
  const { nodes: newNodes, edges: newEdges } = workflow.createNodes(startPosition, options)
  
  const idMap = new Map()
  const createdNodeIds = []

  withBatchUpdates(() => {
    newNodes.forEach(node => {
      const nodeId = addNode(node.type, node.position, node.data)
      idMap.set(node.id, nodeId)
      createdNodeIds.push(nodeId)
    })

    newEdges.forEach(edge => {
      const sourceId = idMap.get(edge.source)
      const targetId = idMap.get(edge.target)
      if (!sourceId || !targetId) return
      addEdge({
        source: sourceId,
        target: targetId,
        sourceHandle: edge.sourceHandle || 'right',
        targetHandle: edge.targetHandle || 'left'
      })
    })
  })

  requestAnimationFrame(() => {
    createdNodeIds.forEach((id) => updateNodeInternals(id))
  })
  
  window.$message?.success(`已添加工作流: ${workflow.name}`)
}

// Handle add asset from history panel | 处理从历史面板添加资产
const handleHistoryAddToCanvas = (asset) => {
  const spawnPosition = getSpawnPosition()
  const nodeType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
  const nodeId = withBatchUpdates(() => addNode(nodeType, { x: spawnPosition.x - 100, y: spawnPosition.y - 100 }, {
    url: asset.src,
    label: asset.title || (nodeType === 'video' ? '视频' : nodeType === 'audio' ? '音频' : '图片'),
    model: asset.model || '',
    duration: asset.duration || 0
  }))

  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)

  window.$message?.success('已添加到画布')
}

// Handle canvas drop | 处理画布拖放
const handleCanvasDrop = async (e) => {
  e.preventDefault()

  // Check if dropping files | 检查是否拖放文件
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const files = Array.from(e.dataTransfer.files)
    const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })

    const tasks = files
      .map((file, index) => {
        const fileType = file.type
        if (fileType.startsWith('image/')) {
          return fileToBase64(file).then((base64) => ({ ok: true, index, type: 'image', file, base64 })).catch((err) => ({ ok: false, index, type: 'image', file, err }))
        }
        if (fileType.startsWith('audio/')) {
          return fileToBase64(file).then((base64) => ({ ok: true, index, type: 'audio', file, base64 })).catch((err) => ({ ok: false, index, type: 'audio', file, err }))
        }
        if (fileType.startsWith('video/')) {
          return fileToBase64(file).then((base64) => ({ ok: true, index, type: 'video', file, base64 })).catch((err) => ({ ok: false, index, type: 'video', file, err }))
        }
        return null
      })
      .filter(Boolean)

    const results = await Promise.all(tasks)
    const createdNodeIds = []
    let successCount = 0

    withBatchUpdates(() => {
      results.forEach((result) => {
        if (!result.ok) {
          console.error(`${result.type} upload error:`, result.err)
          window.$message?.error(`${result.type === 'image' ? '图片' : result.type === 'audio' ? '音频' : '视频'}上传失败: ${result.file.name}`)
          return
        }

        const nodeId = addNode(result.type, {
          x: position.x - 100 + result.index * 50,
          y: position.y - 100 + result.index * 50
        }, {
          url: result.base64,
          fileName: result.file.name,
          fileType: result.file.type,
          label: result.type === 'image' ? '上传图片' : result.type === 'audio' ? '上传音频' : '上传视频'
        })

        createdNodeIds.push(nodeId)
        successCount += 1
      })
    })

    requestAnimationFrame(() => {
      createdNodeIds.forEach((id) => updateNodeInternals(id))
    })

    if (successCount > 0) {
      window.$message?.success(`已上传 ${successCount} 个文件`)
    }
    return
  }

  // Check if dropping from history panel | 检查是否从历史面板拖放
  const data = e.dataTransfer.getData('application/json')
  if (!data) return

  try {
    const asset = JSON.parse(data)
    if (!asset.src || !asset.type) return

    const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
    const nodeType = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
    const nodeId = addNode(nodeType, { x: position.x - 100, y: position.y - 100 }, {
      url: asset.src,
      label: asset.title || (nodeType === 'video' ? '视频' : nodeType === 'audio' ? '音频' : '图片'),
      model: asset.model || '',
      duration: asset.duration || 0
    })

    setTimeout(() => {
      updateNodeInternals(nodeId)
    }, 50)

    window.$message?.success('已添加到画布')
  } catch (err) {
    console.error('Drop error:', err)
  }
}

// Convert file to base64 | 将文件转换为 base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Handle director console create nodes | 处理导演台创建节点
const handleDirectorCreateNodes = (payload) => {
  const spawnPosition = getSpawnPosition()
  const startX = spawnPosition.x - 300
  const startY = spawnPosition.y - 200
  const nodeSpacing = 400
  const rowSpacing = 250

  // Create character description node if provided | 如果提供了角色描述，创建角色节点
  let characterNodeId = null
  const shotNodeIds = []
  withBatchUpdates(() => {
    if (payload.styleBible) {
      characterNodeId = addNode('text', { x: startX, y: startY }, {
        content: payload.styleBible,
        label: '角色&美术 Bible'
      })
    }

    // Create shot nodes | 创建分镜节点
    payload.shots.forEach((shot, index) => {
      const shotY = startY + (characterNodeId ? 1 : 0) * rowSpacing + index * rowSpacing

      // Create text node for shot prompt | 创建分镜提示词节点
      const textNodeId = addNode('text', { x: startX, y: shotY }, {
        content: shot,
        label: `分镜${index + 1}`
      })
      shotNodeIds.push(textNodeId)

      // Create imageConfig node if auto-generate is enabled | 如果启用自动生成，创建图片配置节点
      if (payload.autoGenerateImages) {
        const configNodeId = addNode('imageConfig', { x: startX + nodeSpacing, y: shotY }, {
          model: payload.imageModel,
          size: payload.aspectRatio === '16:9' ? '1920x1080' :
                payload.aspectRatio === '9:16' ? '1080x1920' :
                payload.aspectRatio === '1:1' ? '1024x1024' :
                payload.aspectRatio === '4:3' ? '1024x768' : '768x1024',
          label: `分镜${index + 1}`,
          autoExecute: true
        })

        // Connect text to imageConfig | 连接文本到图片配置
        addEdge({
          source: textNodeId,
          target: configNodeId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })

        // Connect character node to imageConfig if exists | 如果有角色节点，连接到图片配置
        if (characterNodeId) {
          addEdge({
            source: characterNodeId,
            target: configNodeId,
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        }
      }
    })
  })

  // Update node internals | 更新节点内部
  setTimeout(() => {
    if (characterNodeId) updateNodeInternals(characterNodeId)
    shotNodeIds.forEach(id => updateNodeInternals(id))
  }, 100)

  window.$message?.success(`已创建 ${payload.shots.length} 个分镜节点`)
}

// Handle sketch editor generate | 处理草图编辑器生成
const handleSketchGenerate = (payload) => {
  const spawnPosition = getSpawnPosition()
  const nodeType = payload.type === 'video' ? 'video' : 'image'
  const nodeId = addNode(nodeType, { x: spawnPosition.x - 100, y: spawnPosition.y - 100 }, {
    url: payload.url,
    label: payload.type === 'video' ? '涂鸦生视频' : '涂鸦生图',
    prompt: payload.prompt
  })

  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)

  window.$message?.success(`${payload.type === 'video' ? '视频' : '图片'}已添加到画布`)
}

const handleSonicGenerated = (tracks) => {
  const list = Array.isArray(tracks) ? tracks : []
  if (list.length === 0) return

  list.forEach((track) => {
    if (!track?.audioUrl) return
    addAsset({
      type: 'audio',
      src: track.audioUrl,
      title: track.title || '音频',
      model: track.model || 'Suno'
    })
  })

  window.$message?.success(`已保存 ${list.length} 条音频到历史素材`)
}

const handleSonicAddToCanvas = (track) => {
  if (!track?.audioUrl) return
  handleHistoryAddToCanvas({
    type: 'audio',
    src: track.audioUrl,
    title: track.title || '音频',
    model: track.model || 'Suno',
    duration: track.duration || 0
  })
}

const handleLyricsInsert = (payload) => {
  const content = (payload?.text || '').trim()
  if (!content) return

  const spawnPosition = getSpawnPosition()
  const nodeId = addNode('text', { x: spawnPosition.x - 100, y: spawnPosition.y - 100 }, {
    content,
    label: payload?.title || '歌词'
  })

  setTimeout(() => {
    updateNodeInternals(nodeId)
  }, 50)

  window.$message?.success('歌词已添加到画布')
}

// Handle connection | 处理连接
const onConnect = (params) => {
  // Check if connecting image to videoConfig | 检查是否将图片连接到视频配置
  const sourceNode = nodes.value.find(n => n.id === params.source)
  const targetNode = nodes.value.find(n => n.id === params.target)
  
  if (sourceNode?.type === 'image' && targetNode?.type === 'videoConfig') {
    // Use imageRole edge type | 使用图片角色边类型
    addEdge({
      ...params,
      type: 'imageRole',
      data: { imageRole: 'first_frame_image' } // Default to first frame | 默认首帧
    })
  } else {
    addEdge(params)
  }
}

// Context menu state | 右键菜单状态
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  type: null,
  target: null
})

// Handle node context menu | 处理节点右键菜单
const onNodeContextMenu = (event) => {
  event.event.preventDefault()
  contextMenu.value = {
    show: true,
    x: event.event.clientX,
    y: event.event.clientY,
    type: 'node',
    target: event.node
  }
}

// Handle edge context menu | 处理边右键菜单
const onEdgeContextMenu = (event) => {
  event.event.preventDefault()
  event.event.stopPropagation()
  contextMenu.value = {
    show: true,
    x: event.event.clientX,
    y: event.event.clientY,
    type: 'edge',
    target: event.edge
  }
}

// Close context menu | 关闭右键菜单
const closeContextMenu = () => {
  contextMenu.value.show = false
}

// Node context menu options | 节点右键菜单选项
const nodeContextMenuOptions = computed(() => {
  if (!contextMenu.value.target) return []

  const node = contextMenu.value.target
  const options = [
    {
      label: '复制节点',
      key: 'duplicate',
      icon: () => h(NIcon, null, { default: () => h(CopyOutline) })
    },
    {
      label: '删除节点',
      key: 'delete',
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) })
    }
  ]

  if (node.type === 'image' || node.type === 'video') {
    options.unshift({
      label: '下载素材',
      key: 'download',
      icon: () => h(NIcon, null, { default: () => h(DownloadOutline) })
    })
  }

  return options
})

// Edge context menu options | 边右键菜单选项
const edgeContextMenuOptions = computed(() => {
  if (!contextMenu.value.target) return []

  const edge = contextMenu.value.target
  const options = [
    {
      label: '删除连接',
      key: 'delete',
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) })
    }
  ]

  const sourceNode = nodes.value.find(n => n.id === edge.source)
  const targetNode = nodes.value.find(n => n.id === edge.target)

  if (sourceNode?.type === 'image' && targetNode?.type === 'videoConfig') {
    options.unshift(
      {
        label: '设为首帧',
        key: 'set-first-frame',
        icon: () => h(NIcon, null, { default: () => h(ImageOutline) })
      },
      {
        label: '设为尾帧',
        key: 'set-last-frame',
        icon: () => h(NIcon, null, { default: () => h(ImageOutline) })
      },
      {
        label: '设为参考图',
        key: 'set-reference',
        icon: () => h(NIcon, null, { default: () => h(ImageOutline) })
      }
    )
  }

  return options
})

const syncDebugEnabled = () => {
  try {
    debugEnabled.value = localStorage.getItem('nexus-debug-image') === '1'
  } catch {
    debugEnabled.value = false
  }
}

const refreshDebugLogs = () => {
  try {
    const logs = window.__nexusImageDebug
    if (!Array.isArray(logs) || logs.length === 0) {
      debugText.value = '暂无日志'
      return
    }
    debugText.value = JSON.stringify(logs, null, 2)
  } catch {
    debugText.value = '日志读取失败'
  }
}

const openDebugPanel = () => {
  syncDebugEnabled()
  refreshDebugLogs()
  openPanel('debug')
}

const toggleDebugLogging = () => {
  try {
    if (debugEnabled.value) {
      localStorage.removeItem('nexus-debug-image')
      debugEnabled.value = false
      window.$message?.info('调试采集已关闭')
    } else {
      localStorage.setItem('nexus-debug-image', '1')
      debugEnabled.value = true
      window.$message?.success('调试采集已开启，请复现一次')
    }
  } catch {
    window.$message?.error('调试采集开关失败')
  }
}

const clearDebugLogs = () => {
  try {
    window.__nexusImageDebug = []
    debugText.value = '暂无日志'
    window.$message?.success('日志已清空')
  } catch {
    window.$message?.error('日志清空失败')
  }
}

const copyDebugLogs = async () => {
  const text = debugText.value || ''
  if (!text) {
    window.$message?.warning('暂无可复制内容')
    return
  }
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      window.$message?.success('日志已复制')
      return
    }
  } catch {
    // fallback below
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    window.$message?.success('日志已复制')
  } catch {
    window.$message?.error('复制失败')
  }
}

// Handle context menu action | 处理右键菜单操作
const handleContextMenuAction = (key) => {
  const { type, target } = contextMenu.value

  if (type === 'node') {
    switch (key) {
      case 'duplicate':
        const newNodeId = duplicateNode(target.id)
        if (newNodeId) {
          setTimeout(() => updateNodeInternals(newNodeId), 50)
          window.$message?.success('节点已复制')
        }
        break
      case 'delete':
        removeNode(target.id)
        window.$message?.success('节点已删除')
        break
      case 'download':
        if (target.data?.url) {
          const link = document.createElement('a')
          link.href = target.data.url
          link.download = `${target.data.label || 'asset'}-${Date.now()}.${target.type === 'video' ? 'mp4' : 'png'}`
          link.click()
          window.$message?.success('开始下载')
        }
        break
    }
  } else if (type === 'edge') {
    if (!target?.id) {
      closeContextMenu()
      return
    }
    switch (key) {
      case 'delete':
        removeEdge(target.id)
        window.$message?.success('连接已删除')
        break
      case 'set-first-frame':
        {
          updateCanvasEdge(target.id, { imageRole: 'first_frame_image' })
          scheduleProjectSave()
          manualSaveHistory()
          window.$message?.success('已设为首帧')
        }
        break
      case 'set-last-frame':
        {
          updateCanvasEdge(target.id, { imageRole: 'last_frame_image' })
          scheduleProjectSave()
          manualSaveHistory()
          window.$message?.success('已设为尾帧')
        }
        break
      case 'set-reference':
        {
          updateCanvasEdge(target.id, { imageRole: 'input_reference' })
          scheduleProjectSave()
          manualSaveHistory()
          window.$message?.success('已设为参考图')
        }
        break
    }
  }

  closeContextMenu()
}

// Handle node click | 处理节点点击
const onNodeClick = (event) => {
  const node = event?.node
  if (!node) return

  if (batchConnectMode.value) {
    handleBatchConnectTarget(node.id)
    return
  }

  if (node.type === 'text') {
    focusedTextNodeId.value = node.id
  }
}

const flushMouseMove = () => {
  mouseMoveRaf = 0
  if (!pendingMouseEvent || !screenToFlowCoordinate) return
  const { clientX, clientY } = pendingMouseEvent
  lastMousePosition.value = screenToFlowCoordinate({ x: clientX, y: clientY })
  pendingMouseEvent = null
}

const markCanvasInteracting = () => {
  isCanvasInteracting.value = true
  if (interactionTimer) clearTimeout(interactionTimer)
  interactionTimer = setTimeout(() => {
    isCanvasInteracting.value = false
  }, 140)
}

const onPaneMouseMove = (event) => {
  if (!event) return
  pendingMouseEvent = event
  if (mouseMoveRaf) return
  mouseMoveRaf = requestAnimationFrame(flushMouseMove)
}

const onViewportChange = (vp) => {
  if (vp && typeof vp === 'object') flowViewport.value = vp
  markCanvasInteracting()
  // 节点多时触发快速交互模式
  if ((nodes.value?.length || 0) > GPU_NODE_THRESHOLD) {
    markRapidInteraction()
  }
}

// Handle viewport change end | 视口变化结束（仅保存，避免高频重复写入/更新）
const onViewportChangeEnd = (vp) => {
  const next = vp && typeof vp === 'object' ? vp : flowViewport.value
  if (next && typeof next === 'object') {
    updateViewport(next)
  } else {
    scheduleProjectSave()
  }
  isCanvasInteracting.value = false
}

// Handle node drag stop | 节点拖拽结束（仅保存，避免拖拽过程高频触发）
const onNodeDragStop = () => {
  isDragging.value = false
  isCanvasInteracting.value = false
  scheduleStatsUpdate()
  scheduleProjectSave()
}

const onNodeDragStart = () => {
  isDragging.value = true
  markCanvasInteracting()
  // 节点多时触发快速交互模式
  if ((nodes.value?.length || 0) > GPU_NODE_THRESHOLD) {
    markRapidInteraction()
  }
}

// Handle nodes change | 处理节点变化（用于拖拽等高频更新的轻量保存）
const onNodesChange = (changes) => {
  const realRemovals = changes?.filter(change =>
    change.type === 'remove' &&
    nodes.value.some(n => n.id === change.id)
  )
  if (!realRemovals?.length) return

  scheduleProjectSave()

  // 清理因节点删除导致的悬空连线 + 保存历史（避免出现“连线指向不存在节点”） | prune dangling edges after node removal + save history
  nextTick(() => {
    const existingNodeIds = new Set(nodes.value.map(n => n.id))
    pruneDanglingEdges(existingNodeIds)
    manualSaveHistory()
  })
}

// Handle edges change | 处理边变化
const onEdgesChange = (changes) => {
  // Check if any edge is being removed | 检查是否有边被删除
  const hasRemoval = changes.some(change => change.type === 'remove')
  
  if (hasRemoval) {
    scheduleProjectSave()

    // Trigger history save after edge removal | 边删除后触发历史保存
    nextTick(() => {
      manualSaveHistory()
    })
  }
}

// Handle pane click | 处理画布点击
const onPaneClick = (event) => {
  showNodeMenu.value = false
  focusedTextNodeId.value = null
  if (event) {
    onPaneMouseMove(event)
  }
  cancelBatchConnect(true)
  // Clear all selections | 清除所有选中
  // nodes.value = nodes.value.map(node => ({
  //   ...node,
  //   selected: false
  // }))
}


// Handle project action | 处理项目操作
const handleProjectAction = (key) => {
  switch (key) {
    case 'rename':
      renameValue.value = projectName.value
      showRenameModal.value = true
      break
    case 'duplicate':
      // TODO: Implement duplicate
      window.$message?.info('复制功能开发中')
      break
    case 'delete':
      showDeleteModal.value = true
      break
    case 'bench-5k':
      createBench5k()
      break
  }
}

const createBench5k = () => {
  try {
    clearCanvas()
    renderMode.value = 'gpu'
    persistRenderMode()
    const total = 5000
    const cols = 100
    const gapX = 70
    const gapY = 70
    const startX = 80
    const startY = 80

    withBatchUpdates(() => {
      for (let i = 0; i < total; i++) {
        const x = startX + (i % cols) * gapX
        const y = startY + Math.floor(i / cols) * gapY
        const type = i % 7 === 0 ? 'image' : i % 7 === 1 ? 'video' : i % 7 === 2 ? 'text' : 'imageConfig'
        addNode(type, { x, y }, {
          label: `${type} ${i}`,
          zIndex: i % 200
        })
      }
      // Sparse edges
      for (let i = 0; i < total - 1; i += 3) {
        addEdge({
          source: `node_${i}`,
          target: `node_${i + 1}`,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
      }
    })

    updateViewport({ x: 40, y: 40, zoom: 0.35 })
    scheduleProjectSave()
    manualSaveHistory()
    window.$message?.success('已生成 5000 节点压测画布（已切到 GPU 模式）')
  } catch (err) {
    window.$message?.error(err?.message || '生成压测画布失败')
  }
}

// Confirm rename | 确认重命名
const confirmRename = () => {
  const projectId = route.params.id
  if (renameValue.value.trim()) {
    renameProject(projectId, renameValue.value.trim())
    window.$message?.success('已重命名')
  }
  showRenameModal.value = false
}

// Confirm delete | 确认删除
const confirmDelete = () => {
  const projectId = route.params.id
  // deleteProject(projectId) // TODO: import deleteProject
  showDeleteModal.value = false
  window.$message?.success('项目已删除')
  router.push('/')
}

// Handle Enter key | 处理回车键
const handleEnterKey = (e) => {
  e.preventDefault()
  sendMessage()
}

// Handle AI polish | 处理 AI 润色
const handlePolish = async () => {
  const input = chatInput.value.trim()
  if (!input) return
  
  // Check API configuration | 检查 API 配置
  if (!isApiConfigured.value) {
    window.$message?.warning('请先配置 API Key')
    openPanel('apiSettings')
    return
  }

  isProcessing.value = true
  const originalInput = chatInput.value

  try {
    // Call AI polish with canvas context | 调用 AI 润色（带画布上下文）
    const result = await polish({ text: input, focusNodeId: focusedTextNodeId.value, stream: true })
    
    if (result) {
      chatInput.value = result
      window.$message?.success('提示词已润色')
    }
  } catch (err) {
    chatInput.value = originalInput
    window.$message?.error(err.message || '润色失败')
  } finally {
    isProcessing.value = false
  }
}

const clearChatHistory = () => {
  clearChat()
  window.$message?.success('对话已清空')
  isChatAtBottom.value = true
  scrollChatToBottom(true)
}

const handlePromptInsert = (text) => {
  const value = (text || '').trim()
  if (!value) return
  chatInput.value = chatInput.value.trim() ? `${chatInput.value.trim()}\n\n${value}` : value
  nextTick(() => autoResizeChatInput())
}

const autoResizeChatInput = () => {
  const el = chatInputRef.value
  if (!el) return
  try {
    el.style.height = 'auto'
    const max = autoExecute.value ? 120 : 320
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
  } catch {
    // ignore
  }
}

const readFileAsDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(reader.error || new Error('读取失败'))
      reader.readAsDataURL(file)
    } catch (err) {
      reject(err)
    }
  })
}

const handleAttachmentUpload = async (event) => {
  const files = Array.from(event?.target?.files || [])
  if (event?.target) event.target.value = ''
  if (!files.length) return

  for (const file of files.slice(0, 6)) {
    if (!file || !file.type || !file.type.startsWith('image/')) continue
    try {
      const previewUrl = await readFileAsDataUrl(file)
      chatAttachments.value = [
        ...chatAttachments.value,
        {
          id: globalThis.crypto?.randomUUID?.() || `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          fileName: file.name || 'image',
          mimeType: file.type,
          previewUrl
        }
      ].slice(0, 6)
    } catch {
      window.$message?.warning('读取图片失败，已跳过')
    }
  }
}

const removeAttachment = (id) => {
  chatAttachments.value = chatAttachments.value.filter(a => a.id !== id)
}

const formatClarificationForChat = (result) => {
  const ctx = String(result?.clarification_context || '').trim()
  const qs = Array.isArray(result?.clarification_questions) ? result.clarification_questions : []
  const lines = []
  if (ctx) lines.push(ctx)
  if (qs.length) {
    lines.push('需要你补充：')
    qs.slice(0, 6).forEach((q, idx) => {
      const question = String(q?.question || '').trim()
      if (!question) return
      lines.push(`${idx + 1}. ${question}`)
    })
  }
  return lines.join('\n')
}

const normalizeClarificationQuestions = (questions) => {
  const list = Array.isArray(questions) ? questions : []
  const used = new Set()
  return list.map((q, idx) => {
    const rawKey = typeof q?.key === 'string' ? q.key.trim() : ''
    let key = rawKey || `q_${idx + 1}`
    while (used.has(key)) {
      key = `${key}_${idx + 1}`
    }
    used.add(key)
    return {
      ...q,
      key
    }
  })
}

const formatWorkflowForChat = (result) => {
  const desc = String(result?.description || '').trim()
  const type = String(result?.workflow_type || '').trim()
  const output = String(result?.output_mode || '').trim()
  const lines = []
  if (desc) lines.push(`已识别任务：${desc}`)
  if (type) lines.push(`工作流类型：${type}`)
  if (output) lines.push(`输出模式：${output}`)
  return lines.join('\n')
}

// Send message | 发送消息
const sendMessage = async () => {
  const input = chatInput.value.trim()
  if (!input && chatAttachments.value.length === 0) return

  // Check API configuration | 检查 API 配置
  if (!isApiConfigured.value) {
    window.$message?.warning('请先配置 API Key')
    openPanel('apiSettings')
    return
  }

  isProcessing.value = true
  currentResponse.value = ''
  let content = chatInput.value
  chatInput.value = ''
  nextTick(() => autoResizeChatInput())
  const attachments = chatAttachments.value.slice()
  chatAttachments.value = []

  try {
  let baseX = 100
  let baseY = 100
  if (lastMousePosition.value) {
    baseX = lastMousePosition.value.x - 100
    baseY = lastMousePosition.value.y - 100
  } else {
    let maxY = 0
    if (nodes.value.length > 0) {
      maxY = Math.max(...nodes.value.map(n => n.position.y))
    }
    baseY = maxY + 200
  }

    // If attachments exist, create reference image nodes first | 如果有附件，先落地到画布作为参考图节点
    let referenceNodeIds = []
    if (attachments.length > 0) {
      const spawnX = baseX - 460
      const spawnY = baseY
      withBatchUpdates(() => {
        attachments.forEach((att, index) => {
          const nodeId = addNode('image', { x: spawnX, y: spawnY + index * 280 }, {
            url: att.previewUrl,
            label: `参考图${index + 1}`,
            isReference: true,
            updatedAt: Date.now()
          })
          referenceNodeIds.push(nodeId)
        })
      })
      window.$message?.success(`已添加 ${referenceNodeIds.length} 张参考图到画布`)
    }

    if (autoExecute.value) {
      // Auto-execute mode: analyze intent and execute workflow | 自动执行模式：分析意图并执行工作流
      if (!content.trim() && referenceNodeIds.length > 0) {
        content = '我上传了参考图。请先用一句话概括参考图内容，然后问我希望生成什么画面/风格/用途，再执行生图。'
      }
      appendChat('user', content)
      if (memoryEnabled.value) {
        const hits = extractMemoriesHeuristic(content)
        hits.forEach((t) => addMemoryItem(t, { importance: 0.65, source: 'chat' }))
        ensureMemorySummary()
      }
      window.$message?.info('正在分析工作流...')

      try {
        // Analyze user intent | 分析用户意图
        const hint = referenceNodeIds.length > 0 ? `\n\n【参考图】已上传 ${referenceNodeIds.length} 张参考图（可用于风格/角色一致性/图生图）。` : ''
        const result = await analyzeIntent(`${content}${hint}`)

        // Check if clarification is needed | 检查是否需要澄清
        if (result?.needs_clarification && Array.isArray(result.clarification_questions) && result.clarification_questions.length > 0) {
          appendChat('assistant', formatClarificationForChat(result))
          // Show clarification dialog | 显示澄清对话框
          clarificationContext.value = result.clarification_context || '请补充以下信息以获得更好的结果'
          clarificationQuestions.value = normalizeClarificationQuestions(result.clarification_questions)
          clarificationAnswers.value = {}
          pendingWorkflowResult.value = result
          pendingWorkflowPosition.value = { x: baseX, y: baseY }
          originalUserInput.value = content
          showClarificationModal.value = true
          window.$message?.info('请补充一些信息以获得更好的结果')
          return
        }

        appendChat('assistant', formatWorkflowForChat(result))

        // Ensure we have valid workflow params | 确保有效的工作流参数
        const workflowParams = {
          workflow_type: result?.workflow_type || WORKFLOW_TYPES.TEXT_TO_IMAGE,
          output_mode: result?.output_mode || 'workflow',
          raw_input: content,
          reference_node_ids: referenceNodeIds,
          image_prompt: result?.image_prompt || content,
          video_prompt: result?.video_prompt || content,
          script: result?.script,
          character: result?.character,
          shots: result?.shots,
          multi_angle: result?.multi_angle
        }

        const modeLabel = workflowParams.output_mode === 'text_only' ? '文字输出' : '自动生成'
        window.$message?.info(`执行工作流: ${result?.description || '文生图'}（${modeLabel}）`)

        // Execute the workflow | 执行工作流
        await executeWorkflow(workflowParams, { x: baseX, y: baseY })

        window.$message?.success('工作流已启动')
      } catch (err) {
        console.error('Workflow error:', err)
        appendChat('assistant', `执行失败：${err?.message || '未知错误'}\n已回退到默认文生图工作流。`)
        // Fallback to simple text-to-image | 回退到文生图
        window.$message?.warning('使用默认文生图工作流')
        await createTextToImageWorkflow(content, { x: baseX, y: baseY })
      }
    } else {
      // Manual mode: chat only | 手动模式：仅对话
      const extras = enableWebSearch.value ? { web_search: true } : {}
      if (memoryEnabled.value) {
        const hits = extractMemoriesHeuristic(content)
        hits.forEach((t) => addMemoryItem(t, { importance: 0.65, source: 'chat' }))
        ensureMemorySummary()
      }
      await sendChat(content, true, extras)
      await nextTick()
      if (chatHistoryRef.value) {
        scrollChatToBottom(true)
      }
    }
  } catch (err) {
    if (!chatInput.value) {
      chatInput.value = content
    }
    window.$message?.error(err.message || '创建失败')
  } finally {
    isProcessing.value = false
  }
}

// Handle clarification submit | 处理澄清提交
const handleClarificationSubmit = async () => {
  showClarificationModal.value = false
  isProcessing.value = true

  try {
    // Build enhanced input with clarification answers | 构建带澄清答案的增强输入
    const answersText = clarificationQuestions.value
      .map(q => {
        const answer = clarificationAnswers.value[q.key]
        if (!answer) return null
        const custom = clarificationAnswers.value[`${q.key}_custom`]
        const finalAnswer = String(answer).includes('其他') && custom ? custom : answer
        return `${q.question}: ${finalAnswer}`
      })
      .filter(Boolean)
      .join('\n')

    const enhancedInput = answersText
      ? `${originalUserInput.value}\n\n【补充信息】\n${answersText}`
      : originalUserInput.value

    // Re-analyze with enhanced input | 用增强输入重新分析
    window.$message?.info('正在重新分析...')
    const result = await analyzeIntent(enhancedInput)

    // Build workflow params | 构建工作流参数
    const workflowParams = {
      workflow_type: result?.workflow_type || pendingWorkflowResult.value?.workflow_type || WORKFLOW_TYPES.TEXT_TO_IMAGE,
      output_mode: result?.output_mode || 'workflow',
      raw_input: enhancedInput,
      image_prompt: result?.image_prompt || enhancedInput,
      video_prompt: result?.video_prompt || enhancedInput,
      script: result?.script,
      character: result?.character,
      shots: result?.shots,
      multi_angle: result?.multi_angle
    }

    const modeLabel = workflowParams.output_mode === 'text_only' ? '文字输出' : '自动生成'
    window.$message?.info(`执行工作流: ${result?.description || '文生图'}（${modeLabel}）`)

    // Execute workflow | 执行工作流
    await executeWorkflow(workflowParams, pendingWorkflowPosition.value)
    window.$message?.success('工作流已启动')
  } catch (err) {
    console.error('Clarification workflow error:', err)
    window.$message?.error(err.message || '执行失败')
  } finally {
    isProcessing.value = false
    // Clear pending state | 清除待处理状态
    pendingWorkflowResult.value = null
    pendingWorkflowPosition.value = null
    originalUserInput.value = ''
    clarificationAnswers.value = {}
  }
}

// Skip clarification and execute directly | 跳过澄清直接执行
const handleClarificationSkip = async () => {
  showClarificationModal.value = false
  isProcessing.value = true

  try {
    const result = pendingWorkflowResult.value
    const workflowParams = {
      workflow_type: result?.workflow_type || WORKFLOW_TYPES.TEXT_TO_IMAGE,
      output_mode: result?.output_mode || 'workflow',
      raw_input: originalUserInput.value,
      image_prompt: result?.image_prompt || originalUserInput.value,
      video_prompt: result?.video_prompt || originalUserInput.value,
      script: result?.script,
      character: result?.character,
      shots: result?.shots,
      multi_angle: result?.multi_angle
    }

    window.$message?.info('跳过补充信息，直接执行...')
    await executeWorkflow(workflowParams, pendingWorkflowPosition.value)
    window.$message?.success('工作流已启动')
  } catch (err) {
    console.error('Skip clarification error:', err)
    window.$message?.error(err.message || '执行失败')
  } finally {
    isProcessing.value = false
    pendingWorkflowResult.value = null
    pendingWorkflowPosition.value = null
    originalUserInput.value = ''
    clarificationAnswers.value = {}
  }
}

// Go back to home | 返回首页
const goBack = () => {
  router.push('/')
}

// Check if mobile | 检测是否移动端
const checkMobile = () => {
  isMobile.value = window.innerWidth < 768
}

// Load project by ID | 根据ID加载项目
const loadProjectById = async (projectId) => {
  // Update flow key to force VueFlow re-render | 更新 key 强制 VueFlow 重新渲染
  flowKey.value = Date.now()
  
  if (projectId && projectId !== 'new') {
    await loadProject(projectId)
  } else {
    // New project - clear canvas | 新项目 - 清空画布
    clearCanvas()
  }

  // Keep controlled viewport in sync with persisted viewport | 同步受控 viewport（避免平移/缩放时触发额外响应式开销）
  flowViewport.value = { ...canvasViewport.value }

  // Auto switch to GPU mode for large graphs (unless user pinned) | 大画布自动切 GPU（用户手动选择后不再干预）
  maybeAutoSwitchRenderMode()
}

// Watch for route changes | 监听路由变化
watch(
  () => route.params.id,
  async (newId, oldId) => {
    if (newId && newId !== oldId) {
      // Save current project before switching | 切换前保存当前项目
      if (oldId) {
        saveProject()
      }
      // Load new project | 加载新项目
      await loadProjectById(newId)
    }
  }
)

// Initialize | 初始化
onMounted(async () => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  
  // Initialize projects store | 初始化项目存储
  await initProjectsStore()
  
  // Load project data | 加载项目数据
  await loadProjectById(route.params.id)
  
  // Check for initial prompt from home page | 检查来自首页的初始提示词
  const initialPrompt = sessionStorage.getItem('ai-canvas-initial-prompt')
  if (initialPrompt) {
    sessionStorage.removeItem('ai-canvas-initial-prompt')
    chatInput.value = initialPrompt
    // Auto-send the message | 自动发送消息
    nextTick(() => {
      sendMessage()
    })
  }
})

// Cleanup on unmount | 卸载时清理
onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
  if (mouseMoveRaf) {
    cancelAnimationFrame(mouseMoveRaf)
    mouseMoveRaf = 0
  }
  if (statsRaf) {
    cancelAnimationFrame(statsRaf)
    statsRaf = 0
  }
  // Save project before leaving | 离开前保存项目
  saveProject()
})
</script>

<style>
/* Import Vue Flow styles | 引入 Vue Flow 样式 */
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
@import '@vue-flow/minimap/dist/style.css';

.canvas-flow {
  width: 100%;
  height: 100%;
  transition: opacity 0.15s ease-out;
}

/* GPU 覆盖层激活时，降低 DOM 层不透明度（视觉上更平滑） */
.canvas-flow.gpu-overlay-active {
  opacity: 0.3;
}

/* GPU 覆盖层样式 */
.gpu-overlay-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

/* GPU 层淡入淡出动画 */
.gpu-fade-enter-active {
  transition: opacity 0.1s ease-out;
}

.gpu-fade-leave-active {
  transition: opacity 0.2s ease-in;
}

.gpu-fade-enter-from,
.gpu-fade-leave-to {
  opacity: 0;
}

.nexus-floating-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

/* Slide right transition | 右侧滑入动画 */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.3s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
