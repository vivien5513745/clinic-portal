// ============================================================
// 會議紀錄(密碼保護頁)
//
// - 通行碼不以明文存在程式裡,只存 SHA-256 雜湊值用來驗證
// - 資料來源網址以通行碼衍生的金鑰(PBKDF2)加密存放(ENC_URL),
//   沒有通行碼的人即使看原始碼也拿不到試算表連結
// - ENC_URL 留空時顯示示範資料(仍需通過通行碼驗證)
//
// 試算表欄位:會議日期, 會議名稱, 會議地點, 會議紀錄, 會議照片, 簽到表
// (後三欄放 Google Drive 分享連結,沒有就留空)
// ============================================================
const SALT = "dgp-mtg";
const PASS_HASH = "29e14bb0a386128a7f87b064b14a0a4e835bf206a040f8cd41472102ab6eb668";
// 加密後的試算表網址(需以正確通行碼解密)
const ENC_URL =
  "c8eebee186f8b53da9501702c0c1285399c25f28d353d403012055d3368afc3d638b62e781cd6b99acbb543510abaa3c96ae3d6551826d38e2129078b6b4d78e6bba659836f31c295fd3b48c3d8adcb5546ed0eb2de8beab89eec43aae763284980273167bb0a41189381e";

const enc = new TextEncoder();

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 用 PBKDF2 金鑰流解密網址(XOR)
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

function toDate(s) {
  const m = String(s).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

// 只接受網址,忽略「(Drive連結)」之類的佔位文字
function asLink(v) {
  const s = String(v || "").trim();
  return /^https?:\/\//.test(s) ? s : "";
}

async function loadMeetings(pass) {
  const url = await decryptUrl(pass, ENC_URL);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = parseCSV(await res.text());
  const header = rows[0].map((h) => h.trim());
  const col = (kw) => header.findIndex((h) => h.includes(kw));
  const iDate = col("日期"), iName = col("名稱"), iPlace = col("地點"),
        iMin = col("紀錄"), iPhoto = col("照片"), iSign = col("簽到");
  return rows.slice(1).map((r) => ({
    date: (r[iDate] || "").trim(),
    name: (r[iName] || "").trim(),
    place: iPlace >= 0 ? (r[iPlace] || "").trim() : "",
    minutes: iMin >= 0 ? asLink(r[iMin]) : "",
    photos: iPhoto >= 0 ? asLink(r[iPhoto]) : "",
    signin: iSign >= 0 ? asLink(r[iSign]) : "",
  })).filter((m) => m.name);
}

function renderMeetings(meetings) {
  const list = document.getElementById("meeting-list");
  list.innerHTML = "";
  // 依日期新→舊排序
  [...meetings].sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0)).forEach((m) => {
    const art = document.createElement("article");
    art.className = "post";
    const links = [
      m.minutes ? `<a class="btn-sm outline" href="${escText(m.minutes)}" target="_blank" rel="noopener">📄 會議紀錄</a>` : "",
      m.photos ? `<a class="btn-sm outline" href="${escText(m.photos)}" target="_blank" rel="noopener">📷 會議照片</a>` : "",
      m.signin ? `<a class="btn-sm outline" href="${escText(m.signin)}" target="_blank" rel="noopener">✍️ 簽到表</a>` : "",
    ].filter(Boolean).join("");
    art.innerHTML = `
      <div class="post-top">
        <span class="tag info">會議</span>
        <span class="date">${escText(m.date)}${m.place ? ` · ${escText(m.place)}` : ""}</span>
      </div>
      <h3>${escText(m.name)}</h3>
      ${links ? `<div class="post-actions">${links}</div>` : ""}
    `;
    list.appendChild(art);
  });
}

async function unlock(pass) {
  const hash = await sha256Hex(`${SALT}|${pass}`);
  if (hash !== PASS_HASH) return false;
  sessionStorage.setItem("portal_pass", pass);
  document.getElementById("lock-panel").style.display = "none";
  const content = document.getElementById("meeting-content");
  content.style.display = "block";
  try {
    renderMeetings(await loadMeetings(pass));
  } catch (e) {
    console.error("讀取會議紀錄失敗", e);
    document.getElementById("meeting-list").innerHTML = `
      <div class="notice error"><span>⚠️</span><span>無法載入會議資料,請稍後再試。</span></div>`;
  }
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  // 同一瀏覽器工作階段內解鎖過(含收案儀表板頁)就不用重新輸入
  const saved = sessionStorage.getItem("portal_pass");
  if (saved) await unlock(saved);

  document.getElementById("lock-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ok = await unlock(document.getElementById("lock-input").value.trim());
    document.getElementById("lock-error").style.display = ok ? "none" : "block";
  });
});
