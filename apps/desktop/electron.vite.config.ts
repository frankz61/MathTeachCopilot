import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// @mtc/* 是工作区内的 TS 源码包，不能当外部依赖，必须让 vite 一起编译
const workspacePkgs = ['@mtc/shared', '@mtc/workspace', '@mtc/skills']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      // outDir 默认相对 root，会落到仓库根的 out/，而主进程按
      // apps/desktop/out/renderer/ 去找 index.html —— 必须显式指定，否则打包后白屏
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      // 打包后页面走 file://，相对 URL 的字体很可能被 CSP 的 'self' 拦掉，
      // 公式会掉回系统字体。把 KaTeX 的 woff2 内联成 data URI，零请求、不受影响。
      // Chromium 只用 woff2，woff/ttf 留作文件即可（体积不是约束）。
      assetsInlineLimit: (filePath: string) => (filePath.endsWith('.woff2') ? true : undefined),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
})
