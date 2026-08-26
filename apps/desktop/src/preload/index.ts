import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AgentEvent,
  type AgentRunRequest,
  type CreateLessonRequest,
  type ExportRequest,
  type LessonStatus,
  type LlmSettings,
  type MtcApi,
  type Problem,
} from '@mtc/shared'

/**
 * 渲染层只能看到这里列出的东西。契约定义在 @mtc/shared 的 ipc.ts，
 * 两边共用一份类型，改一处对不上就编译不过。
 */
const api: MtcApi = {
  listLessons: () => ipcRenderer.invoke(IPC.listLessons),
  readLesson: (lessonId) => ipcRenderer.invoke(IPC.readLesson, lessonId),
  loadCurriculum: () => ipcRenderer.invoke(IPC.loadCurriculum),
  createLesson: (req: CreateLessonRequest) => ipcRenderer.invoke(IPC.createLesson, req),
  readFigure: (lessonId: string, ref: string) => ipcRenderer.invoke(IPC.readFigure, lessonId, ref),
  saveAttachment: (lessonId: string, fileName: string, dataUri: string) =>
    ipcRenderer.invoke(IPC.saveAttachment, lessonId, fileName, dataUri),
  exportDocx: (req: ExportRequest) => ipcRenderer.invoke(IPC.exportDocx, req),
  deleteProblem: (lessonId: string, problemId: string) =>
    ipcRenderer.invoke(IPC.deleteProblem, lessonId, problemId),
  updateProblem: (lessonId: string, problem: Problem) =>
    ipcRenderer.invoke(IPC.updateProblem, lessonId, problem),
  setLessonStatus: (lessonId: string, status: LessonStatus) =>
    ipcRenderer.invoke(IPC.setLessonStatus, lessonId, status),
  windowMinimize: () => ipcRenderer.invoke(IPC.windowMinimize),
  windowToggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
  windowClose: () => ipcRenderer.invoke(IPC.windowClose),
  onWindowState: (cb: (maximized: boolean) => void) => {
    const listener = (_: unknown, maximized: boolean): void => cb(maximized)
    ipcRenderer.on(IPC.windowState, listener)
    return () => ipcRenderer.off(IPC.windowState, listener)
  },
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (s: LlmSettings) => ipcRenderer.invoke(IPC.saveSettings, s),
  testLlm: (s: LlmSettings) => ipcRenderer.invoke(IPC.testLlm, s),
  listImageModels: (s: LlmSettings) => ipcRenderer.invoke(IPC.listImageModels, s),
  runAgent: (req: AgentRunRequest) => ipcRenderer.invoke(IPC.runAgent, req),
  interruptAgent: () => ipcRenderer.invoke(IPC.interruptAgent),
  onAgentEvent: (cb: (lessonId: string, e: AgentEvent) => void) => {
    const listener = (_: unknown, lessonId: string, e: AgentEvent): void => cb(lessonId, e)
    ipcRenderer.on(IPC.agentEvent, listener)
    return () => ipcRenderer.off(IPC.agentEvent, listener)
  },
  onLessonChanged: (cb: (lessonId: string) => void) => {
    const listener = (_: unknown, lessonId: string): void => cb(lessonId)
    ipcRenderer.on(IPC.lessonChanged, listener)
    return () => ipcRenderer.off(IPC.lessonChanged, listener)
  },
}

contextBridge.exposeInMainWorld('mtc', api)
