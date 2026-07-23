// ============================================================
// 合作診所名單:讀取「診所名單」Google 試算表
// 欄位:醫療院所名稱, 地區, 區域, google評價, 數位領航員
// - google評價欄若填入網址,「在 Google 地圖開啟」會直接使用該連結
//   (沒填則以「名稱 + 地區」搜尋 Google 地圖)
// - 在試算表新增/修改列後,網頁重新整理即會更新
// ============================================================
const CLINICS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/18N4fig9ecmYI8av09y4Ho9S_egx1c0NIgPMVrsf6Hw0/export?format=csv&gid=0";

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

function escText(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("clinic-grid");
  try {
    const res = await fetch(CLINICS_CSV_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseCSV(await res.text());
    const header = rows[0].map((h) => h.trim());
    const col = (kw) => header.findIndex((h) => h.includes(kw));
    const iName = col("名稱"), iCity = col("地區"), iDist = col("區域"),
          iReview = header.findIndex((h) => h.toLowerCase().includes("google") || h.includes("評價")),
          iPilot = col("領航員");

    const clinics = rows.slice(1).map((r) => ({
      name: (r[iName] || "").trim(),
      city: iCity >= 0 ? (r[iCity] || "").trim() : "",
      dist: iDist >= 0 ? (r[iDist] || "").trim() : "",
      review: iReview >= 0 ? (r[iReview] || "").trim() : "",
      pilot: iPilot >= 0 ? (r[iPilot] || "").trim() : "",
    })).filter((c) => c.name);

    if (!clinics.length) throw new Error("試算表沒有院所資料");

    const count = document.getElementById("clinic-count");
    if (count) count.textContent = `共 ${clinics.length} 間醫療院所參與計畫`;

    grid.innerHTML = "";
    clinics.forEach((c) => {
      const area = [c.city, c.dist].filter(Boolean).join(" ");
      // google評價欄有網址就直接用,否則以名稱+地區搜尋地圖
      const mapUrl = /^https?:\/\//.test(c.review)
        ? c.review
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${area || "台中"}`)}`;
      const card = document.createElement("div");
      card.className = "card clinic-card";
      card.innerHTML = `
        <h3>📍 ${escText(c.name)}</h3>
        ${area ? `<p class="addr">${escText(area)}</p>` : ""}
        ${c.pilot ? `<p class="addr">數位領航員:${escText(c.pilot)}</p>` : ""}
        <a class="card-link" href="${escText(mapUrl)}" target="_blank" rel="noopener">在 Google 地圖開啟 →</a>
      `;
      grid.appendChild(card);
    });
  } catch (e) {
    console.error("讀取合作診所名單失敗", e);
    grid.innerHTML = `
      <div class="notice error" style="grid-column:1/-1">
        <span>⚠️</span>
        <span>無法載入診所名單,請稍後再試,或確認試算表的共用權限。</span>
      </div>`;
  }
});
