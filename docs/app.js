/* OTT Radar dashboard */

const SECTION_ORDER = ["hindi", "english", "popular"];
const SECTION_LABELS = {
  hindi: "🇮🇳 Hindi OTT",
  english: "🌍 English OTT",
  popular: "🔥 Popular (Other Languages)",
};

const state = {
  data: null,
  history: [],
  tab: "out_now",
  section: "all",
  platform: "all",
  type: "all",
  search: "",
  historyIndex: null, // when viewing a past digest
};

const $ = (sel) => document.querySelector(sel);
const content = $("#content");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function loadData() {
  try {
    const bust = `?t=${Date.now()}`;
    const [dataRes, historyRes] = await Promise.all([
      fetch(`data.json${bust}`),
      fetch(`history.json${bust}`).catch(() => null),
    ]);
    state.data = await dataRes.json();
    if (historyRes && historyRes.ok) state.history = await historyRes.json();
    populatePlatformFilter();
    $("#generated-at").textContent = `Updated ${new Date(state.data.generated_at).toLocaleString()}`;
    render();
  } catch (err) {
    content.innerHTML = `<p class="empty">Could not load data yet. The first scheduled run will populate this dashboard.<br><small>${esc(err.message)}</small></p>`;
  }
}

function activeDigest() {
  if (state.tab === "history" && state.historyIndex != null) {
    return state.history[state.historyIndex];
  }
  return state.data;
}

function allItems(digest) {
  const out = [];
  for (const windowKey of ["out_now", "coming_up"]) {
    const sections = digest?.[windowKey]?.sections || {};
    for (const items of Object.values(sections)) out.push(...items);
  }
  return out;
}

function populatePlatformFilter() {
  const platforms = new Set();
  for (const item of allItems(state.data)) {
    (item.providers || []).forEach((p) => platforms.add(p));
  }
  const select = $("#platform-filter");
  const current = select.value;
  select.innerHTML = '<option value="all">All platforms</option>';
  [...platforms].sort().forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function matchesFilters(item) {
  if (state.type !== "all" && item.media_type !== state.type) return false;
  if (state.platform !== "all" && !(item.providers || []).includes(state.platform)) return false;
  if (state.search) {
    const q = state.search.toLowerCase();
    if (!item.title.toLowerCase().includes(q) && !(item.overview || "").toLowerCase().includes(q)) return false;
  }
  return true;
}

function cardHtml(item) {
  const kind = item.media_type === "movie" ? "Movie" : "Show";
  const rating = item.rating ? `⭐ ${Number(item.rating).toFixed(1)}` : "No rating yet";
  const poster = item.poster_url
    ? `<img class="poster" src="${esc(item.poster_url)}" alt="" loading="lazy">`
    : `<div class="poster">${item.media_type === "movie" ? "🎬" : "📺"}</div>`;
  const providers = (item.providers || []).slice(0, 3).join(", ");
  return `
    <a class="card" href="${esc(item.tmdb_url)}" target="_blank" rel="noopener">
      ${poster}
      <div class="card-body">
        <p class="card-title">${esc(item.title)}</p>
        <p class="card-meta"><span class="badge">${kind}</span>${esc(item.release_date)} · ${rating}</p>
        ${providers ? `<p class="card-providers">${esc(providers)}</p>` : ""}
        ${item.overview ? `<p class="card-overview">${esc(item.overview)}</p>` : ""}
      </div>
    </a>`;
}

function groupByProvider(items) {
  const groups = new Map();
  for (const item of items) {
    const key = (item.providers || []).slice(0, 2).join(", ") || "Platform TBA";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderWindow(digest, windowKey) {
  const win = digest?.[windowKey];
  if (!win) return '<p class="empty">No data.</p>';

  let html = `<p class="window-note">${esc(win.start)} → ${esc(win.end)}</p>`;
  let any = false;

  for (const section of SECTION_ORDER) {
    if (state.section !== "all" && state.section !== section) continue;
    const items = (win.sections?.[section] || []).filter(matchesFilters);
    if (!items.length) continue;
    any = true;
    html += `<div class="section-block"><h2>${SECTION_LABELS[section]}</h2>`;
    for (const [provider, providerItems] of groupByProvider(items)) {
      html += `<p class="provider-label">${esc(provider)}</p>`;
      html += `<div class="grid">${providerItems.map(cardHtml).join("")}</div>`;
    }
    html += "</div>";
  }

  if (!any) html += '<p class="empty">Nothing matches the current filters.</p>';
  return html;
}

function countItems(digest) {
  return allItems(digest).length;
}

function renderHistory() {
  if (state.historyIndex != null) {
    const digest = state.history[state.historyIndex];
    return `
      <p class="window-note"><a href="#" id="back-to-history">← All past digests</a></p>
      <h2 style="margin:8px 2px;">Digest from ${new Date(digest.generated_at).toLocaleString()}</h2>
      <h3 style="margin:16px 2px 0;">🟢 Out Now</h3>
      ${renderWindow(digest, "out_now")}
      <h3 style="margin:16px 2px 0;">🔵 Coming Up</h3>
      ${renderWindow(digest, "coming_up")}`;
  }
  if (!state.history.length) {
    return '<p class="empty">No past digests yet. Each scheduled run adds one here.</p>';
  }
  return state.history
    .map(
      (d, i) => `
      <div class="history-entry" data-index="${i}">
        <h3>${new Date(d.generated_at).toLocaleString()}</h3>
        <p>Out now: ${esc(d.out_now.start)} → ${esc(d.out_now.end)} · ${countItems(d)} titles</p>
      </div>`
    )
    .join("");
}

function render() {
  $("#filters").style.display = state.tab === "history" && state.historyIndex == null ? "none" : "grid";
  if (state.tab === "history") {
    content.innerHTML = renderHistory();
    content.querySelectorAll(".history-entry").forEach((el) =>
      el.addEventListener("click", () => {
        state.historyIndex = Number(el.dataset.index);
        render();
      })
    );
    const back = $("#back-to-history");
    if (back)
      back.addEventListener("click", (e) => {
        e.preventDefault();
        state.historyIndex = null;
        render();
      });
    return;
  }
  content.innerHTML = state.data ? renderWindow(state.data, state.tab) : '<p class="empty">Loading…</p>';
}

/* Event wiring */
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.tab = tab.dataset.tab;
    state.historyIndex = null;
    render();
  })
);

document.querySelectorAll("#section-chips .chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    document.querySelectorAll("#section-chips .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.section = chip.dataset.section;
    render();
  })
);

$("#platform-filter").addEventListener("change", (e) => {
  state.platform = e.target.value;
  render();
});
$("#type-filter").addEventListener("change", (e) => {
  state.type = e.target.value;
  render();
});
$("#search").addEventListener("input", (e) => {
  state.search = e.target.value.trim();
  render();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

loadData();
