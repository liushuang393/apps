/*
 * ルール管理画面の共通スクリプト。
 * セッションCookieで /api/rules/** を叩く。素の fetch のみ。
 */
"use strict";

/**
 * CSRFトークンを cookie から読む。
 *
 * 画面（/admin/**）は CSRF の対象で、除外しているのは /api/** だけ。
 * ログアウトのようなフォーム外の POST では自分でトークンを載せる必要がある。
 * cookie は HttpOnly を外して払い出してある（SecurityConfig 参照）。
 */
function csrfToken() {
  const entry = document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="));
  return entry ? decodeURIComponent(entry.substring("XSRF-TOKEN=".length)) : "";
}

const Api = {
  async get(path) {
    const res = await fetch(path, { headers: { Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      location.href = "login.html";
      throw new Error("unauthenticated");
    }
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`);
    }
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("権限がありません（承認は approver / 変更は admin）");
    }
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try { message = JSON.parse(text).message || text; } catch (ignored) { /* 生文のまま */ }
      throw new Error(message);
    }
    return text ? JSON.parse(text) : null;
  },
};

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function query(name) {
  return new URLSearchParams(location.search).get(name);
}

function showError(err) {
  const box = document.getElementById("error");
  if (!box) { alert(err.message); return; }
  box.className = "warn";
  box.textContent = "エラー: " + err.message;
}

function renderNav(active) {
  document.querySelectorAll("header nav a").forEach((a) => {
    if (a.dataset.page === active) { a.style.fontWeight = "700"; }
  });
}
