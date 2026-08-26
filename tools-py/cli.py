"""给 Electron 主进程直接调用的命令行入口。

MCP server 是给 **Agent** 用的；有些动作是**老师直接点按钮**触发的（比如导出），
不该绕一圈让 Agent 代劳——那样又慢又可能被模型改主意。

用法：参数给子命令，JSON 从 stdin 进、从 stdout 出。

    echo '{"lessonDir": "...", "withAnswers": true}' | python cli.py export

之所以走 stdin 而不是命令行参数：题干里全是 LaTeX 反斜杠和中文，
Windows 上拼命令行必踩转义的坑。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# 和 server.py 同一个理由：随包分发的 embeddable Python 带 ._pth，
# 脚本目录不会自动进 sys.path，不加这一行打包后 import 不到 mathtools。
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mathtools.export import export_docx
from mathtools.homework import regenerate
from mathtools.store import save_problems


def cmd_export(req: dict[str, Any]) -> dict[str, Any]:
    lesson_dir = Path(req["lessonDir"])
    problems_file = lesson_dir / "problems.json"
    if not problems_file.exists():
        return {"ok": False, "error": f"找不到 {problems_file}"}

    try:
        problems = json.loads(problems_file.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "error": f"problems.json 解析失败：{e}"}

    return export_docx(
        problems,
        req["outPath"],
        title=req.get("title") or "分层作业",
        with_answers=bool(req.get("withAnswers", True)),
        # 题干里的 ![](assets/xxx.svg) 是相对课时目录的，pandoc 要靠这个找到图
        resource_dir=str(lesson_dir),
    )


def cmd_homework(req: dict[str, Any]) -> dict[str, Any]:
    return regenerate(req["lessonDir"])


def cmd_update_problem(req: dict[str, Any]) -> dict[str, Any]:
    """老师改完一道题，**立刻按 check 重新验算**再落盘。

    这是编辑功能的关键：改了答案而验证戳还挂着绿色，等于产品在撒谎。
    所以走和 Agent 完全一样的闸门——save_problems 会自己跑验算、自己写 verify。
    """
    lesson_dir = Path(req["lessonDir"])
    problems_file = lesson_dir / "problems.json"
    edited = req["problem"]

    try:
        problems = json.loads(problems_file.read_text(encoding="utf-8"))
    except Exception as e:
        return {"ok": False, "errors": [f"problems.json 解析失败：{e}"]}

    idx = next((i for i, p in enumerate(problems) if p.get("id") == edited.get("id")), None)
    if idx is None:
        return {"ok": False, "errors": [f"找不到题目 {edited.get('id')}"]}

    # 没有 check 的老数据：改完无法机器验证，如实标黄而不是假装还是绿的
    if not edited.get("check"):
        edited["check"] = {
            "kind": "manual",
            "reason": "这道题没有验算规格（老数据或人工录入），教师修改后需自行确认",
        }

    result = save_problems([edited], str(problems_file), mode="replace_one")
    return result


COMMANDS = {
    "export": cmd_export,
    "homework": cmd_homework,
    "update_problem": cmd_update_problem,
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(
            json.dumps(
                {"ok": False, "error": f"用法：cli.py [{'|'.join(COMMANDS)}]"},
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"入参不是合法 JSON：{e}"}, ensure_ascii=False))
        sys.exit(1)

    try:
        result = COMMANDS[sys.argv[1]](req)
    except KeyError as e:
        result = {"ok": False, "error": f"缺少参数 {e}"}
    except Exception as e:  # 兜底：主进程那边只认 JSON，不能让 traceback 漏出去
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
