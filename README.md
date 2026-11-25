# LEVEL UP 學習站

每週三 21:00 LEVEL UP 11 週課程的學習網站：重點整理、小作業、準備週 30 名單。

- `index.html`：網頁（最上方「可編輯設定」區：夥伴名單、作業題目、每週重點 `WEEKS`）
- `_worker.js`：後端 API（Cloudflare Pages advanced mode）

## Cloudflare Pages 設定
- 建置命令：留空　輸出目錄：`/`
- 繫結：D1 資料庫，變數名稱 `DB`
- 選用環境變數：`TEAM_CODE`（設定後交作業需輸入通關碼）

推送到 `main` 後 Cloudflare 會自動部署。
