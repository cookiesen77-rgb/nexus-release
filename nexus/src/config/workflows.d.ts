/**
 * Workflow Templates Type Declarations
 */

export interface MultiAnglePrompt {
  label: string
  english: string
  prompt: (character: string) => string
}

export interface MultiAnglePrompts {
  front: MultiAnglePrompt
  side: MultiAnglePrompt
  back: MultiAnglePrompt
  top: MultiAnglePrompt
  [key: string]: MultiAnglePrompt
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, any>
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  icon: string
  category: string
  cover?: string
  createNodes: (startPosition: { x: number; y: number }) => {
    nodes: WorkflowNode[]
    edges: WorkflowEdge[]
  }
}

export const MULTI_ANGLE_PROMPTS: MultiAnglePrompts
export const WORKFLOW_TEMPLATES: WorkflowTemplate[]
export function getWorkflowById(id: string): WorkflowTemplate | undefined
export function getWorkflowsByCategory(category: string): WorkflowTemplate[]
export default WORKFLOW_TEMPLATES
