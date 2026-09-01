"""env_required_list: the comma-separated sibling of env_required, used for
NOTIFY_OWNER_EMAILS (an owner can have more than one Google account)."""

from __future__ import annotations

import pytest

import releasebot as rb


def test_env_required_list_splits_and_strips(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "a@example.com, b@example.com,c@example.com ")
    assert rb.env_required_list("SOME_LIST") == [
        "a@example.com",
        "b@example.com",
        "c@example.com",
    ]


def test_env_required_list_single_value(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "only@example.com")
    assert rb.env_required_list("SOME_LIST") == ["only@example.com"]


def test_env_required_list_missing_raises(monkeypatch):
    monkeypatch.delenv("SOME_LIST", raising=False)
    with pytest.raises(RuntimeError, match="SOME_LIST"):
        rb.env_required_list("SOME_LIST")


def test_env_required_list_empty_string_raises(monkeypatch):
    monkeypatch.setenv("SOME_LIST", "")
    with pytest.raises(RuntimeError, match="SOME_LIST"):
        rb.env_required_list("SOME_LIST")


def test_env_required_list_whitespace_and_commas_only_raises(monkeypatch):
    monkeypatch.setenv("SOME_LIST", " , , ")
    with pytest.raises(RuntimeError, match="SOME_LIST"):
        rb.env_required_list("SOME_LIST")
