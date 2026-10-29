"""lookup_curriculum 的版本范围。

两版教材都有「线段、射线、直线」这类同名知识点。关键词搜索不限版本的话，
Agent 会拿另一版的错因和前置去出这一版的题。
"""

from mathtools import curriculum


def _textbooks(result):
    return {f["textbook"] for f in result["found"]}


def test_query_without_scope_searches_all_books(monkeypatch):
    monkeypatch.delenv("MTC_TEXTBOOK", raising=False)
    r = curriculum.lookup(query="方程", limit=200)
    assert _textbooks(r) == {"北师大版", "人教版"}


def test_query_is_limited_to_scoped_book(monkeypatch):
    monkeypatch.setenv("MTC_TEXTBOOK", "北师大版")
    r = curriculum.lookup(query="方程", limit=200)
    assert r["found"]
    assert _textbooks(r) == {"北师大版"}


def test_lookup_by_id_ignores_scope(monkeypatch):
    # 人教版课时在北师版偏好下照样要能查到自己的知识点
    monkeypatch.setenv("MTC_TEXTBOOK", "北师大版")
    r = curriculum.lookup(ids=["rj-tp-25-03"])
    assert [f["textbook"] for f in r["found"]] == ["人教版"]
