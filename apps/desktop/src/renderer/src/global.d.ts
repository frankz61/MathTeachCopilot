import type { MtcApi } from '@mtc/shared'

declare global {
  interface Window {
    mtc: MtcApi
  }
}

export {}
