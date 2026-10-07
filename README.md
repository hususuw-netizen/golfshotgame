# 高爾夫記桿工具

完整前端與免費 Google Apps Script／Google 試算表後端。

## 使用網站

- 分享網址：https://hususuw-netizen.github.io/golfshotgame/
- 同步版：https://script.google.com/macros/s/AKfycbwVzQndsaHQHljuax4XIAVJWMix5bui5NevsAaGwkMCB3-dl35BJ4wYFSfzHk3UGeDQ/exec

GitHub Pages 發佈 `main` 分支的 `/docs` 資料夾，入口自動導向同步版。Apps Script 才執行後端，GitHub 儲存完整程式與部署文件。

## 功能

- 學號與姓名登入，輸入框預設空白；後端核對學生名單。
- 模擬球場、純記桿數、歷史紀錄及 CSV 匯出。
- 純記桿數先保存在本機，按「同步到後端」並輸入全班密碼才同步。
- 登入只讀回歷史；恢復網路不自動上傳。刪除也需要按鍵與密碼才同步到後端。
- 試算表依學號數字排序；支援簡短版工作表。

## 設定同步密碼

在 Google Apps Script 專案的「專案設定 → 指令碼屬性」新增：

| 屬性 | 值 |
|---|---|
| `CLASS_SYNC_PASSWORD` | 老師親自設定的全班同步密碼 |

勿將正式密碼寫入程式、GitHub 或測試檔。未設定屬性時，後端拒絕同步。學號姓名登入及本機記錄仍可使用。

## 程式與部署

- 根目錄：可編輯的 HTML、CSS、JavaScript 前端。
- `apps-script/Code.gs`：學生登入、紀錄存取、密碼驗證、排序及去重後端。
- `apps-script/Index.html`：由前端打包產生，部署在 Apps Script。
- `apps-script/appsscript.json`：Google 執行環境與權限設定。
- `apps-script/部署說明.md`：完整設定與驗證步驟。
- `apps-script/short-sheet-formula.txt`：簡短版自動更新公式。
- `docs/index.html`：GitHub Pages 同步版入口。

更新前端後執行 `node build-apps-script.mjs`，把生成的 Index.html 與 Code.gs 更新至 Google 專案，再透過管理部署建立新版本。

驗證：`node tests/cloud-sync.test.mjs`。

本機紀錄依網站來源分開保存，舊 GitHub 網站的紀錄不會自動搬入同步版，請先匯出 CSV 備份。
