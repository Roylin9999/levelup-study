// LEVEL UP 學習站 — Cloudflare Pages 後端（advanced mode）
// 需要在 Pages 設定綁定：D1 資料庫，變數名稱 DB
// 選用：環境變數 TEAM_CODE（設定後，交作業要輸入通關碼；不設定則不需要）

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

// ======== 可編輯設定：群組（網址 /api/<群組>/...；"" = 原本的 12 人群組）========
const GROUPS = { "": "", coring: "_coring" };
// ===================================================================================

const ready = {};
async function init(db, sfx) {
  if (ready[sfx]) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS submissions${sfx} (
       week INTEGER NOT NULL,
       name TEXT NOT NULL,
       answers TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       PRIMARY KEY (week, name)
     )`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS namelists${sfx} (
       name TEXT PRIMARY KEY,
       pin_hash TEXT NOT NULL,
       items TEXT NOT NULL,
       count INTEGER NOT NULL,
       updated_at TEXT NOT NULL
     )`
  ).run();
  ready[sfx] = true;
}

async function hashPin(name, pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("levelup|" + name + "|" + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: "尚未綁定 D1 資料庫（變數名稱 DB）" }, 500);
    // /api/coring/xxx → 群組 coring，路徑改寫成 /api/xxx
    let grp = "";
    const m = url.pathname.match(/^\/api\/([a-z0-9-]+)(\/.*)$/);
    if (m && m[1] in GROUPS && m[1] !== "") { grp = m[1]; url.pathname = "/api" + m[2]; }
    const sfx = GROUPS[grp];
    const T_SUB = "submissions" + sfx, T_LIST = "namelists" + sfx;
    await init(env.DB, sfx);
    const needCode = !!env.TEAM_CODE;

    // 某週所有人的作業
    if (url.pathname === "/api/submissions" && request.method === "GET") {
      const week = parseInt(url.searchParams.get("week"), 10);
      if (!(week >= 1 && week <= 11)) return json({ error: "週次錯誤" }, 400);
      const { results } = await env.DB.prepare(
        `SELECT name, answers, updated_at FROM ${T_SUB} WHERE week = ? ORDER BY updated_at`
      ).bind(week).all();
      return json({
        needCode,
        items: results.map(r => ({ name: r.name, answers: JSON.parse(r.answers), updated_at: r.updated_at })),
      });
    }

    // 交作業（同一週同一人再交 = 更新）
    if (url.pathname === "/api/submissions" && request.method === "POST") {
      let b;
      try { b = await request.json(); } catch { return json({ error: "資料格式錯誤" }, 400); }
      if (needCode && (b.code || "") !== env.TEAM_CODE) return json({ error: "通關碼不正確" }, 403);
      const week = parseInt(b.week, 10);
      const name = String(b.name || "").trim();
      const answers = Array.isArray(b.answers) ? b.answers.map(a => String(a).slice(0, 3000)) : [];
      if (!(week >= 1 && week <= 11)) return json({ error: "週次錯誤" }, 400);
      if (!name || name.length > 20) return json({ error: "請選擇名字" }, 400);
      if (!answers.length || answers.some(a => !a.trim())) return json({ error: "每一題都要填喔" }, 400);
      const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19); // 台灣時間
      await env.DB.prepare(
        `INSERT INTO ${T_SUB} (week, name, answers, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(week, name) DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at`
      ).bind(week, name, JSON.stringify(answers), now).run();
      return json({ ok: true });
    }

    // 30 名單：大家只看得到數量
    if (url.pathname === "/api/list/counts") {
      const { results } = await env.DB.prepare(`SELECT name, count FROM ${T_LIST}`).all();
      return json({ items: results });
    }

    // 30 名單：讀取／儲存自己的（需要個人密碼；第一次儲存＝設定密碼）
    if ((url.pathname === "/api/list/get" || url.pathname === "/api/list/save") && request.method === "POST") {
      let b;
      try { b = await request.json(); } catch { return json({ error: "資料格式錯誤" }, 400); }
      const name = String(b.name || "").trim();
      const pin = String(b.pin || "").trim();
      if (!name || name.length > 20) return json({ error: "請選擇名字" }, 400);
      if (!/^\d{4,8}$/.test(pin)) return json({ error: "密碼請輸入 4–8 位數字" }, 400);
      const h = await hashPin(name, pin);
      const row = await env.DB.prepare(`SELECT pin_hash, items FROM ${T_LIST} WHERE name = ?`).bind(name).first();
      if (row && row.pin_hash !== h) return json({ error: "密碼不正確（忘記密碼請找忠嶢重設）" }, 403);

      if (url.pathname === "/api/list/get") return json({ items: row ? JSON.parse(row.items) : [] });

      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30)
        .map(x => [String((x || [])[0] || "").slice(0, 20), String((x || [])[1] || "").slice(0, 40)]);
      const count = items.filter(x => x[0].trim()).length;
      const now = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19);
      await env.DB.prepare(
        `INSERT INTO ${T_LIST} (name, pin_hash, items, count, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET items = excluded.items, count = excluded.count, updated_at = excluded.updated_at`
      ).bind(name, h, JSON.stringify(items), count, now).run();
      return json({ ok: true, count });
    }

    // ===== Leader 後台：看全部名單（只有設定了 ADMIN_CODE_<群組> 機密的群組才開放）=====
    if (url.pathname === "/api/admin/lists") {
      const key = "ADMIN_CODE" + (grp ? "_" + grp.toUpperCase() : "");
      const code = env[key];
      if (!code) return json({ error: `這個群組還沒開放後台（需在 Cloudflare 設定機密 ${key}）` }, 403);
      if ((request.headers.get("X-Admin-Code") || "") !== code) return json({ error: "後台密碼不正確" }, 403);
      const lists = await env.DB.prepare(`SELECT name, items, count, updated_at FROM ${T_LIST}`).all();
      const subs = await env.DB.prepare(`SELECT week, name FROM ${T_SUB}`).all();
      return json({
        lists: lists.results.map(r => ({ name: r.name, count: r.count, updated_at: r.updated_at, items: JSON.parse(r.items) })),
        subs: subs.results,
      });
    }

    // 繳交進度表
    if (url.pathname === "/api/progress") {
      const { results } = await env.DB.prepare(`SELECT week, name FROM ${T_SUB}`).all();
      return json({ items: results });
    }

    return json({ error: "Not found" }, 404);
  },
};
