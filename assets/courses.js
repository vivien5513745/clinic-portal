// ============================================================
// 課程公告:自動讀取 Google 試算表
// 欄位:日期, 時間, 課程名稱, 說明, 狀態(報名中/籌備中/已結束), 報名連結
// 在試算表新增/修改列後,網頁重新整理即會更新。
// ============================================================
const COURSES_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1N0uBLRJhWveqBox4F6s_wC7yRD0JsrdlF5MPmIBlrr0/export?format=csv&gid=0";

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cell += c;
    } else if (c === '"') inQuote = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function statusTag(status) {
  if (status.includes("報名")) return { cls: "open", label: status };
  if (status.includes("結束")) return { cls: "closed", label: status };
  return { cls: "info", label: status || "公告" };
}

function toDate(s) {
  const m = String(s).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function weekday(d) {
  return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
}

document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("course-list");
  try {
    const res = await fetch(COURSES_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCSV(await res.text());
    const header = rows[0].map((h) => h.trim());
    const col = (name) => header.findIndex((h) => h.includes(name));
    const iDate = col("日期"), iTime = col("時間"), iName = col("課程名稱"),
          iDesc = col("說明"), iStatus = col("狀態"), iLink = col("報名連結");
    // 課程海報/課程表欄:標頭含「海報」或「課程表」即可
    const iPoster = header.findIndex((h) => h.includes("海報") || h.includes("課程表"));

    const courses = rows.slice(1).map((r) => ({
      date: (r[iDate] || "").trim(),
      time: (r[iTime] || "").trim(),
      name: (r[iName] || "").trim(),
      desc: (r[iDesc] || "").trim(),
      status: (r[iStatus] || "").trim(),
      link: (r[iLink] || "").trim(),
      poster: iPoster >= 0 ? (r[iPoster] || "").trim() : "",
    })).filter((c) => c.name);

    if (!courses.length) throw new Error("試算表沒有課程資料");

    // 排序:進行中/即將開始的課程照日期由近到遠排前面,已結束的排最後(新→舊)
    const upcoming = courses.filter((c) => !c.status.includes("結束"))
      .sort((a, b) => (toDate(a.date) || 0) - (toDate(b.date) || 0));
    const past = courses.filter((c) => c.status.includes("結束"))
      .sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0));

    list.innerHTML = "";
    [...upcoming, ...past].forEach((c) => {
      const tag = statusTag(c.status);
      const d = toDate(c.date);
      const dateText = d ? `${c.date}(${weekday(d)})` : c.date;
      const timeText = c.time && c.time !== "待定" ? ` ${c.time}` : (c.time ? `,時間${c.time}` : "");
      const art = document.createElement("article");
      art.className = "post";
      art.innerHTML = `
        <div class="post-top">
          <span class="tag ${tag.cls}">${esc(tag.label)}</span>
          <span class="date">${esc(dateText)}${esc(timeText)}</span>
        </div>
        <h3>${esc(c.name)}</h3>
        ${c.desc ? `<p>${esc(c.desc)}</p>` : ""}
        ${c.poster || (c.link && !c.status.includes("結束")) ? `
        <div class="post-actions">
          ${c.poster ? `<a class="btn-sm outline" href="${esc(c.poster)}" target="_blank" rel="noopener">📋 查看課程表</a>` : ""}
          ${c.link && !c.status.includes("結束") ? `<a class="btn-sm solid" href="${esc(c.link)}" target="_blank" rel="noopener">前往報名 →</a>` : ""}
        </div>` : ""}
      `;
      list.appendChild(art);
    });
  } catch (e) {
    console.error("讀取課程公告失敗", e);
    list.innerHTML = `
      <div class="notice error" style="max-width:780px;margin:0 auto">
        <span>⚠️</span>
        <span>無法載入課程公告,請稍後再試,或確認試算表的共用權限為「知道連結的任何人可檢視」。</span>
      </div>`;
  }
});
