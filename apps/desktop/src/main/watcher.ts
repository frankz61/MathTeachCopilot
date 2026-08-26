/**
 * 课时目录的文件监听。
 *
 * 为什么需要它：这个产品的事实来源是文件，不是内存状态。写文件的可能是 Agent，
 * 也可能是老师自己用别的编辑器改 homework.md、或者从同事那儿拷了一份题库进来。
 * 靠「Agent 说它写完了」来刷新界面，只能覆盖其中一种情况，而且时序还容易错
 * ——工具调用发出的时刻并不是文件落盘的时刻。
 *
 * 监听目录则对所有情况都成立。
 */
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

/** 编辑器和系统会产生一堆临时文件，别为它们刷新 */
const IGNORED = /(^\.|~$|\.tmp$|\.swp$|^\d+$|\.crswap$)/

export class LessonWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private dir: string | null = null

  constructor(private readonly onChange: (lessonDir: string) => void) {}

  /** 切换到新课时；传 null 表示停止监听 */
  watchDir(dir: string | null): void {
    if (dir === this.dir) return
    this.stop()
    this.dir = dir
    if (!dir) return

    try {
      this.watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (filename && IGNORED.test(path.basename(filename.toString()))) return
        this.schedule(dir)
      })
      // 目录被删掉时 fs.watch 会抛 error 事件，不处理会崩主进程
      this.watcher.on('error', () => this.stop())
    } catch {
      // 目录不存在或没权限——不是致命错误，只是失去实时刷新
      this.watcher = null
    }
  }

  /**
   * 合并抖动。一次 save_problems 会触发多个文件事件（写入、重命名、属性更新），
   * 而且写入过程中读到的可能是半个文件，所以要等它安静下来再通知。
   */
  private schedule(dir: string): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.dir === dir) this.onChange(dir)
    }, 180)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.watcher?.close()
    this.watcher = null
    this.dir = null
  }
}
