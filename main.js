// TrackedX Prototype (static)
// - Hash-router pages: #/filtered, #/verified, #/how
// - Fake DexScreener-like streams + "seconds ago"
// - Phantom wallet connect + signMessage (demo fallback)

const $ = (sel) => document.querySelector(sel);

const UI = {
  pageTitle: $("#pageTitle"),
  listRoot: $("#listRoot"),
  searchInput: $("#searchInput"),
  btnRefresh: $("#btnRefresh"),
  navLinks: Array.from(document.querySelectorAll(".navlink")),
  toast: $("#toast"),

  btnConnect: $("#btnConnect"),
  btnSign: $("#btnSign"),
  walletAddr: $("#walletAddr"),
  statusDot: $("#statusDot"),

  statFiltered: $("#statFiltered"),
  statHidden: $("#statHidden"),
  statVerified: $("#statVerified"),
};

const STORAGE_KEY = "trackedx_state_v1";

const state = {
  route: "filtered",
  wallet: {
    connected: false,
    address: null,
    provider: "none", // phantom | demo
  },
  filtered: {
    items: [],
    hiddenCount: 0,
  },
  verified: {
    items: [],
  },
};

function nowMs() {
  return Date.now();
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatCompactUSD(num) {
  // num is dollars
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(1)}K`;
  return `$${Math.round(num)}`;
}

function shortAddr(addr) {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function relTimeFrom(tsMs) {
  const s = Math.max(0, Math.floor((nowMs() - tsMs) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function toast(msg) {
  UI.toast.textContent = msg;
  UI.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => UI.toast.classList.remove("show"), 2200);
}

/* ------------------------- Fake Data Generation ------------------------- */

const WORDS = [
  "Nebula","Kite","Mango","Raptor","Quartz","Ripple","Nova","Vanta","Cobalt","Atlas","Pixel","Lumen",
  "Cinder","Orbit","Saffron","Panda","Kraken","Sonic","Glacier","Drift","Cipher","Echo","Fable","Vortex",
  "Rune","Basil","Comet","Zebra","Bunker","Pulse","Chroma","Tango","Warden","Ion","Karma","Lyra",
];

const SUFFIX = ["Coin","Token","Protocol","AI","Swap","Fi","Labs","Dex","X","Cash","Pad","Guard"];

const SYMBOLS = [
  "NEB","KITE","MNGO","RAPT","QRTZ","RIPL","NOVA","VANT","COB","ATLS","PIXL","LUMN",
  "CNDR","ORBT","SFRN","PNDA","KRKN","SONC","GLCR","DRFT","CPHR","ECHO","FABL","VRTX",
  "RUNE","BASL","COMT","ZBRA","BNKR","PULS","CHRM","TNGO","WRDN","ION","KARM","LYRA",
];

function makeTokenName() {
  const a = pick(WORDS);
  const b = Math.random() < 0.55 ? ` ${pick(SUFFIX)}` : "";
  return `${a}${b}`.trim();
}

function makeSymbol() {
  // Sometimes create meme-ish short ones
  if (Math.random() < 0.25) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const len = randInt(3, 5);
    let s = "";
    for (let i = 0; i < len; i++) s += letters[randInt(0, letters.length - 1)];
    return s;
  }
  return pick(SYMBOLS);
}

function base58Random(len = 44) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[randInt(0, alphabet.length - 1)];
  return out;
}

function makeDevHandle() {
  const prefixes = ["dev", "labs", "team", "build", "alpha", "core", "mint", "node", "vault", "orbit"];
  const mid = ["x", "rx", "neo", "byte", "sol", "cap", "pulse", "grid", "nova", "zen"];
  const n = randInt(10, 9999);
  return `${pick(prefixes)}_${pick(mid)}${n}`;
}

function makeRiskBadge(isVerifiedPage = false) {
  // Verified developers page should look "safer" overall
  const r = Math.random();
  if (isVerifiedPage) {
    if (r < 0.78) return { kind: "ok", label: "Verified" };
    if (r < 0.95) return { kind: "warn", label: "Watch" };
    return { kind: "danger", label: "Flag" };
  }
  // Filtered tokens page: more mixed
  if (r < 0.60) return { kind: "ok", label: "Pass" };
  if (r < 0.88) return { kind: "warn", label: "Caution" };
  return { kind: "danger", label: "Flag" };
}

function genToken({ ageMode = "mixed" } = {}) {
  // Market cap: newer ones start around 8k, older can be up to 1.3m
  const isNew = ageMode === "new" ? true : ageMode === "old" ? false : Math.random() < 0.45;

  const cap = isNew
    ? randFloat(8_000, 45_000)
    : randFloat(45_000, 1_300_000);

  // liquidity ~ 6% to 22% of cap, typical-ish for small tokens
  const liq = cap * randFloat(0.06, 0.22);

  // volume: 0.2x to 2.8x liquidity
  const vol = liq * randFloat(0.2, 2.8);

  // txns: scaled loosely with vol
  const txns = Math.round(clamp(vol / randFloat(80, 220), 12, 4200));

  // age: new = seconds/minutes; old = hours/days
  let listedAt = nowMs();
  if (isNew) {
    listedAt -= randInt(5, 110) * 1000;
  } else {
    // between 10 minutes and 3 days
    listedAt -= randInt(10 * 60, 3 * 24 * 60 * 60) * 1000;
  }

  const name = makeTokenName();
  const sym = makeSymbol();
  const dev = makeDevHandle();

  return {
    id: cryptoRandomId(),
    symbol: sym,
    name,
    marketCap: cap,
    liquidity: liq,
    volume24h: vol,
    txns,
    dev,
    listedAt,
    contract: base58Random(44),
  };
}

function genVerifiedDev() {
  // Verified dev "profile" represented as a "project" row in same table layout
  const project = genToken({ ageMode: "old" });
  // Make it look more established
  project.marketCap = randFloat(120_000, 2_200_000);
  project.liquidity = project.marketCap * randFloat(0.10, 0.28);
  project.volume24h = project.liquidity * randFloat(0.15, 1.8);
  project.txns = Math.round(clamp(project.volume24h / randFloat(120, 260), 30, 5500));
  project.listedAt = nowMs() - randInt(30 * 60, 7 * 24 * 60 * 60) * 1000; // 30min .. 7d
  project.dev = `@${makeDevHandle()}`;
  return project;
}

function cryptoRandomId() {
  // Small stable id
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

/* ------------------------------ Persistence ----------------------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    // shallow merge with current shape
    if (parsed?.wallet) state.wallet = { ...state.wallet, ...parsed.wallet };
    if (parsed?.filtered) state.filtered = { ...state.filtered, ...parsed.filtered };
    if (parsed?.verified) state.verified = { ...state.verified, ...parsed.verified };
  } catch {
    // ignore
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

/* ------------------------------ Rendering ------------------------------ */

function badgeHtml(b) {
  return `<span class="badge ${b.kind}">${b.label}</span>`;
}

function rowHtml(item, pageKind) {
  const badge = makeRiskBadge(pageKind === "verified");
  const devLabel = pageKind === "verified" ? item.dev : `@${item.dev}`;
  const listed = relTimeFrom(item.listedAt);

  return `
    <div class="row" data-id="${item.id}">
      <div class="cell">
        <div class="token">
          <div class="avatar"></div>
          <div class="tmeta">
            <div class="sym">${item.symbol} <span style="margin-left:8px;">${badgeHtml(badge)}</span></div>
            <div class="name">${item.name} • ${shortAddr(item.contract)}</div>
          </div>
        </div>
      </div>
      <div class="cell">${formatCompactUSD(item.marketCap)}</div>
      <div class="cell">${formatCompactUSD(item.liquidity)}</div>
      <div class="cell">${formatCompactUSD(item.volume24h)}</div>
      <div class="cell">${item.txns.toLocaleString()}</div>
      <div class="cell">${devLabel}</div>
      <div class="cell" data-rel="1">${listed}</div>
    </div>
  `;
}

function renderNavActive() {
  UI.navLinks.forEach((a) => {
    const href = a.getAttribute("href");
    const route = (href || "").replace("#/", "");
    a.classList.toggle("active", route === state.route);
  });
}

function currentDataset() {
  if (state.route === "verified") return state.verified.items;
  if (state.route === "how") return [];
  return state.filtered.items; // default filtered
}

function renderPage() {
  renderNavActive();

  if (state.route === "how") {
    UI.pageTitle.textContent = "How it works";
    UI.searchInput.value = "";
    UI.searchInput.disabled = true;
    UI.btnRefresh.disabled = true;

    UI.listRoot.innerHTML = `
      <div style="padding:16px;">
        <div class="card glass" style="padding:16px; border:1px solid rgba(255,255,255,.08);">
          <div style="font-weight:950; letter-spacing:.2px; font-size:15px;">Coming soon</div>
          <p class="muted" style="margin:10px 0 0; line-height:1.55;">
            You’ll add the real explanation later. For now, this prototype simulates:
            deploy scan → liquidity review → behavior watch → listing.
          </p>
          <div class="divider" style="margin:14px 0;"></div>
          <div class="muted" style="font-size:12px;">
            Tip: You can make this page a step-by-step storyboard with screenshots, audit checklist, and “why we blocked it” examples.
          </div>
        </div>
      </div>
    `;
    return;
  }

  UI.searchInput.disabled = false;
  UI.btnRefresh.disabled = false;

  if (state.route === "verified") {
    UI.pageTitle.textContent = "Verified Developers";
  } else {
    UI.pageTitle.textContent = "Filtered Developers";
  }

  const q = (UI.searchInput.value || "").trim().toLowerCase();
  const items = currentDataset();

  const filtered = !q
    ? items
    : items.filter((x) => {
        const dev = String(x.dev || "").toLowerCase();
        return (
          String(x.symbol).toLowerCase().includes(q) ||
          String(x.name).toLowerCase().includes(q) ||
          dev.includes(q)
        );
      });

  UI.listRoot.innerHTML = filtered.map((item) => rowHtml(item, state.route)).join("");

  updateStats();
}

function updateRelTimes() {
  // Update "Listed" column live without re-rendering whole list
  const nodes = UI.listRoot.querySelectorAll('[data-rel="1"]');
  nodes.forEach((n) => {
    const row = n.closest(".row");
    const id = row?.getAttribute("data-id");
    if (!id) return;

    const item =
      state.filtered.items.find((x) => x.id === id) ||
      state.verified.items.find((x) => x.id === id);
    if (!item) return;

    n.textContent = relTimeFrom(item.listedAt);
  });
}

function updateStats() {
  UI.statFiltered.textContent = state.filtered.items.length.toLocaleString();
  UI.statHidden.textContent = state.filtered.hiddenCount.toLocaleString();
  UI.statVerified.textContent = state.verified.items.length.toLocaleString();
}

/* ------------------------------- Routing ------------------------------- */

function parseRoute() {
  const hash = location.hash || "#/filtered";
  const route = hash.replace("#/", "").split("?")[0];
  if (route === "verified" || route === "how" || route === "filtered") return route;
  return "filtered";
}

function setRoute(r) {
  state.route = r;
  saveState();
  renderPage();
}

window.addEventListener("hashchange", () => {
  setRoute(parseRoute());
});

/* -------------------------- Initial Data Seeding ------------------------ */

function seedAll() {
  // 50 initial each
  state.filtered.items = [];
  state.verified.items = [];

  // Hidden rugs counter just for vibe
  state.filtered.hiddenCount = randInt(80, 320);

  for (let i = 0; i < 50; i++) {
    const ageMode = i < 14 ? "new" : "old";
    state.filtered.items.push(genToken({ ageMode }));
  }

  for (let i = 0; i < 50; i++) {
    state.verified.items.push(genVerifiedDev());
  }

  // newest first like feeds
  state.filtered.items.sort((a, b) => b.listedAt - a.listedAt);
  state.verified.items.sort((a, b) => b.listedAt - a.listedAt);

  saveState();
}

/* ------------------------------ Live Feeds ------------------------------ */

function scheduleFilteredStream() {
  // New ones pop more frequently like DexScreener
  const loop = () => {
    const delay = randInt(1800, 5200); // 1.8s..5.2s
    setTimeout(() => {
      // Sometimes block a "rug" (not shown)
      if (Math.random() < 0.22) {
        state.filtered.hiddenCount += 1;
        updateStats();
        loop();
        return;
      }

      const item = genToken({ ageMode: "new" });
      state.filtered.items.unshift(item);

      // cap list size so it doesn't grow forever
      state.filtered.items = state.filtered.items.slice(0, 300);

      if (state.route === "filtered") renderPage();
      else updateStats();

      loop();
    }, delay);
  };
  loop();
}

function scheduleVerifiedStream() {
  // Verified devs should be slower additions
  const loop = () => {
    const delay = randInt(28_000, 65_000); // 28s..65s
    setTimeout(() => {
      const item = genVerifiedDev();
      state.verified.items.unshift(item);
      state.verified.items = state.verified.items.slice(0, 250);

      if (state.route === "verified") renderPage();
      else updateStats();

      loop();
    }, delay);
  };
  loop();
}

/* -------------------------- Phantom Wallet Hooks ------------------------- */

function getPhantomProvider() {
  const anyWindow = window;
  const sol = anyWindow?.solana;
  if (sol && sol.isPhantom) return sol;
  return null;
}

async function connectWallet() {
  const provider = getPhantomProvider();
  if (provider) {
    try {
      const resp = await provider.connect();
      const pubkey = resp?.publicKey?.toString?.() || provider.publicKey?.toString?.();
      if (!pubkey) throw new Error("No public key returned");
      state.wallet.connected = true;
      state.wallet.address = pubkey;
      state.wallet.provider = "phantom";
      saveState();
      syncWalletUI();
      toast("Connected to Phantom");
      return;
    } catch (e) {
      toast("Connect cancelled");
      return;
    }
  }

  // Demo fallback
  state.wallet.connected = true;
  state.wallet.address = base58Random(44);
  state.wallet.provider = "demo";
  saveState();
  syncWalletUI();
  toast("Phantom not found — using demo wallet");
}

async function signMessage() {
  if (!state.wallet.connected) return;

  const msg = `TrackedX prototype sign-in • ${new Date().toISOString()}`;
  const provider = getPhantomProvider();

  if (state.wallet.provider === "phantom" && provider) {
    try {
      const encoded = new TextEncoder().encode(msg);
      const signed = await provider.signMessage(encoded, "utf8");
      // We don't need to display signature; just confirm
      if (!signed?.signature) {
        toast("Signed (no signature returned)");
      } else {
        toast("Message signed");
      }
      return;
    } catch {
      toast("Signature cancelled");
      return;
    }
  }

  // Demo sign
  toast("Demo signed message");
}

function syncWalletUI() {
  if (state.wallet.connected && state.wallet.address) {
    UI.walletAddr.textContent = shortAddr(state.wallet.address);
    UI.statusDot.classList.add("on");
    UI.btnSign.disabled = false;
    UI.btnConnect.textContent = state.wallet.provider === "phantom" ? "Connected" : "Demo Connected";
    UI.btnConnect.disabled = true;
  } else {
    UI.walletAddr.textContent = "Not connected";
    UI.statusDot.classList.remove("on");
    UI.btnSign.disabled = true;
    UI.btnConnect.textContent = "Connect Phantom";
    UI.btnConnect.disabled = false;
  }
}

/* --------------------------------- Wire -------------------------------- */

UI.btnConnect.addEventListener("click", connectWallet);
UI.btnSign.addEventListener("click", signMessage);

UI.searchInput.addEventListener("input", () => renderPage());

UI.btnRefresh.addEventListener("click", () => {
  seedAll();
  renderPage();
  toast("Regenerated fake data");
});

/* --------------------------------- Boot -------------------------------- */

(function boot() {
  loadState();

  // seed if empty (first load)
  if (!state.filtered.items?.length || !state.verified.items?.length) {
    seedAll();
  }

  state.route = parseRoute();
  syncWalletUI();
  renderPage();
  updateStats();

  // update relative time labels
  setInterval(updateRelTimes, 1000);

  // start streams
  scheduleFilteredStream();
  scheduleVerifiedStream();
})();
