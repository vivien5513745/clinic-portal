// ============================================================
// 收案儀表板(密碼保護頁):資料來源為 Google 試算表
//
// - 通行碼不以明文存在程式裡,只存 SHA-256 雜湊值用來驗證
// - 試算表網址以通行碼衍生的金鑰(PBKDF2)加密存放(ENC_URL)
//
// 試算表欄位格式:
//   開始使用日, 醫療院所名稱, 9/30目標數, 6/30目標數, 3/31目標數, 7/15, 6/30, ...(日期欄新→舊)
// - 「實際收案」取最左邊(最新)的日期欄;該欄為 NA 時往右找最近的有效數字
// - 「收案目標」依今天日期自動選擇尚未到期的最近一個階段目標
// - 之後在試算表新增更新的日期欄(插在目標欄右邊),網頁會自動抓最新的
// ============================================================
const SALT = "dgp-mtg";
const PASS_HASH = "29e14bb0a386128a7f87b064b14a0a4e835bf206a040f8cd41472102ab6eb668";
const ENC_URL =
  "c8eebee186f8b53da9501702c0c1285399c25f28d353d403012055d3368afc3d638b62e781cd6b99a9c64f314abdab33b2803a2905846709d35fde4bb9b2a2ac7bfc6adc20e92e3125e6e59c388b9ba5685ef2eb2de8beab89eec43aae763284980273167bb0a41189381e";

const enc = new TextEncoder();

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decryptUrl(pass, hexCipher) {
  const ct = new Uint8Array(hexCipher.match(/../g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(SALT), iterations: 100000, hash: "SHA-256" },
    keyMaterial, ct.length * 8
  );
  const ks = new Uint8Array(bits);
  return new TextDecoder().decode(ct.map((b, i) => b ^ ks[i]));
}

// 簡易 CSV 解析(支援含逗號的引號欄位)
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

function toNum(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "" || s.toUpperCase() === "NA") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

// 把「9/30」這種標頭轉成今年的日期
function headerToDate(mmdd) {
  const m = mmdd.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return new Date(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]));
}

function parseSheet(rows) {
  const header = rows[0].map((h) => h.trim());
  const nameIdx = header.findIndex((h) => h.includes("名稱"));

  // 目標欄:標頭含「目標」,例如「9/30目標數」
  const targetCols = [];
  header.forEach((h, i) => {
    const m = h.match(/(\d{1,2}\/\d{1,2})\s*目標/);
    if (m) targetCols.push({ idx: i, label: m[1], date: headerToDate(m[1]) });
  });

  // 日期欄:標頭為純日期(新→舊排列)
  const dateCols = [];
  header.forEach((h, i) => {
    if (/^\d{1,2}\/\d{1,2}$/.test(h)) dateCols.push({ idx: i, label: h });
  });

  // 依今天選擇當前階段目標:取尚未到期中最早的;全部過期就用最後一個階段
  const today = new Date();
  const sorted = targetCols.filter((t) => t.date).sort((a, b) => a.date - b.date);
  const current = sorted.find((t) => t.date >= today) || sorted[sorted.length - 1];

  const clinics = rows.slice(1).map((r) => {
    const name = (r[nameIdx] || "").trim();
    const target = current ? toNum(r[current.idx]) : null;
    // 從最新日期欄往右找第一個有效數字
    let actual = null, asOf = "";
    for (const dc of dateCols) {
      const v = toNum(r[dc.idx]);
      if (v !== null) { actual = v; asOf = dc.label; break; }
    }
    return { name, target, actual, asOf };
  }).filter((c) => c.name);

  return {
    clinics,
    targetLabel: current ? current.label : "",
    latestLabel: dateCols.length ? dateCols[0].label : "",
  };
}

function rateInfo(rate) {
  if (rate >= 100) return { cls: "done", label: "已達標" };
  if (rate >= 60) return { cls: "ongoing", label: "進行中" };
  return { cls: "behind", label: "待加強" };
}

function render({ clinics, targetLabel, latestLabel }) {
  // 中榮(醫學中心)不計入實際收案與達標率
  const isZhongRong = (name) => name.includes("榮民總醫院");
  const withTarget = clinics.filter((c) => c.target !== null && c.target > 0);
  const totalTarget = withTarget.reduce((s, c) => s + c.target, 0);
  // 實際收案:排除中榮後的加總
  const actualExclZR = clinics
    .filter((c) => !isZhongRong(c.name))
    .reduce((s, c) => s + (c.actual || 0), 0);
  // 整體達標率 = 實際收案(不含中榮)/ 收案總目標
  const overallRate = totalTarget ? Math.round((actualExclZR / totalTarget) * 100) : 0;

  document.getElementById("stat-clinics").textContent = clinics.length;
  document.getElementById("stat-target").textContent = totalTarget.toLocaleString();
  document.getElementById("stat-actual").textContent = actualExclZR.toLocaleString();
  document.getElementById("stat-rate").textContent = overallRate;

  // 動態標題文字
  const src = document.getElementById("data-source-note");
  if (src) {
    src.innerHTML =
      `資料來源:Google 試算表,最新統計日期 <strong>${latestLabel}</strong>。` +
      `實際收案與達標率不含臺中榮民總醫院;達標率以 <strong>${targetLabel} 目標數</strong> 計算。`;
  }
  const thTarget = document.getElementById("th-target");
  const thActual = document.getElementById("th-actual");
  if (thTarget) thTarget.textContent = `收案目標(${targetLabel})`;
  if (thActual) thActual.textContent = `實際收案(${latestLabel})`;

  // 指針儀表卡片:依達標率排序(未設定目標者排最後)
  const view = [...clinics].sort((a, b) => {
    const ra = a.target ? (a.actual || 0) / a.target : -1;
    const rb = b.target ? (b.actual || 0) / b.target : -1;
    return rb - ra;
  });

  const GAUGE_COLORS = { done: "#1a7f4b", ongoing: "#2f6fd0", behind: "#b45309", na: "#aab3c0" };

  // 半圓錶盤 + 指針(pct 超過 100 時指針停在 100,數字照實顯示)
  function gaugeSVG(pct, colorKey) {
    const capped = Math.max(0, Math.min(pct ?? 0, 100));
    const angle = (capped / 100) * 180 - 90; // 指針角度:-90(0%) → +90(100%)
    const color = GAUGE_COLORS[colorKey];
    return `
      <svg class="gauge" viewBox="0 0 200 122" aria-hidden="true">
        <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke="#e8edf5"
              stroke-width="14" stroke-linecap="round" />
        <path d="M 20 110 A 80 80 0 0 1 180 110" fill="none" stroke="${color}"
              stroke-width="14" stroke-linecap="round" pathLength="100"
              stroke-dasharray="${capped} 100" />
        <g transform="rotate(${angle}, 100, 110)">
          <line x1="100" y1="110" x2="100" y2="48" stroke="#1d1d1f" stroke-width="3.5" stroke-linecap="round" />
        </g>
        <circle cx="100" cy="110" r="7" fill="#1d1d1f" />
      </svg>`;
  }

  const list = document.getElementById("clinic-list");
  list.innerHTML = "";
  view.forEach((c) => {
    const card = document.createElement("div");
    card.className = "gauge-card";
    if (c.target === null || c.target === 0) {
      card.innerHTML = `
        ${gaugeSVG(0, "na")}
        <div class="gauge-value na-text">–</div>
        <div class="gauge-name">${c.name}</div>
        <div class="gauge-nums">累計收案 ${c.actual ?? "–"} 人</div>
        <span class="rate-badge na">未設目標</span>
      `;
    } else {
      const rate = Math.round(((c.actual || 0) / c.target) * 100);
      const gap = c.target - (c.actual || 0);
      const info = rateInfo(rate);
      card.innerHTML = `
        ${gaugeSVG(rate, info.cls)}
        <div class="gauge-value" style="color:${GAUGE_COLORS[info.cls]}">${rate}<small>%</small></div>
        <div class="gauge-name">${c.name}</div>
        <div class="gauge-nums">實際 ${c.actual ?? 0} 人 / 目標 ${c.target} 人</div>
        <span class="rate-badge ${info.cls}">${gap > 0 ? `還差 ${gap} 人` : info.label}</span>
      `;
    }
    list.appendChild(card);
  });

  // 明細表(依試算表原始順序)
  const tbody = document.getElementById("table-body");
  tbody.innerHTML = "";
  clinics.forEach((c) => {
    const tr = document.createElement("tr");
    if (c.target === null || c.target === 0) {
      tr.innerHTML = `
        <td>${c.name}</td>
        <td class="num">–</td>
        <td class="num">${c.actual ?? "–"}</td>
        <td class="num">–</td>
        <td class="num">–</td>
      `;
    } else {
      const rate = Math.round(((c.actual || 0) / c.target) * 100);
      const gap = c.target - (c.actual || 0);
      tr.innerHTML = `
        <td>${c.name}</td>
        <td class="num">${c.target}</td>
        <td class="num">${c.actual ?? 0}</td>
        <td class="num">${gap > 0 ? gap : 0}</td>
        <td class="num">${rate}%</td>
      `;
    }
    tbody.appendChild(tr);
  });
}

async function loadAndRender(pass) {
  const errBox = document.getElementById("load-error");
  try {
    const url = await decryptUrl(pass, ENC_URL);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseSheet(parseCSV(await res.text()));
    if (!data.clinics.length) throw new Error("試算表沒有資料列");
    render(data);
  } catch (e) {
    console.error("讀取試算表失敗", e);
    if (errBox) {
      errBox.style.display = "flex";
      errBox.lastElementChild.textContent =
        "無法讀取收案資料,請稍後再試,或確認試算表的共用權限為「知道連結的任何人可檢視」。";
    }
  }
}

async function unlock(pass) {
  const hash = await sha256Hex(`${SALT}|${pass}`);
  if (hash !== PASS_HASH) return false;
  sessionStorage.setItem("portal_pass", pass);
  document.getElementById("lock-panel").style.display = "none";
  document.getElementById("dash-content").style.display = "block";
  await loadAndRender(pass);
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  // 同一瀏覽器工作階段內解鎖過(含會議紀錄頁)就不用重新輸入
  const saved = sessionStorage.getItem("portal_pass");
  if (saved) await unlock(saved);

  document.getElementById("lock-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ok = await unlock(document.getElementById("lock-input").value.trim());
    document.getElementById("lock-error").style.display = ok ? "none" : "block";
  });
});
