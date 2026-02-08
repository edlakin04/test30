// LaunchDetect UI (updated)
// - Title white (CSS)
// - Removed right-side info block entirely
// - Hero is centered
// - Tabs are on the table (All / Filtered / Verified)
// - No search or refresh
// - Badges only: green "Verified ✓" or green "Filtered"
// - Buy/Sell buttons; if not connected => modal with connect
// - Inline notice disappears when wallet connected
// - Phantom connect only (no demo)

const $ = (sel) => document.querySelector(sel);

const UI = {
  homePage: $("#homePage"),
  howRoot: $("#howRoot"),
  btnBack: $("#btnBack"),

  tabsWrap: $("#tabs"),
  tabs: Array.from(document.querySelectorAll(".tab")),

  listRoot: $("#listRoot"),
  tradeNotice: $("#tradeNotice"),
  btnConnectInline: $("#btnConnectInline"),

  btnConnect: $("#btnConnect"),
  walletAddr: $("#walletAddr"),
  walletLabel: $("#walletLabel"),
  statusDot: $("#statusDot"),

  statShown: $("#statShown"),
  statHidden: $("#statHidden"),
  statVerified: $("#statVerified"),

  modalOverlay: $("#modalOverlay"),
  modalConnect: $("#modalConnect"),
  modalClose: $("#modalClose"),
  modalSub: $("#modalSub"),

  toast: $("#toast"),
};

const STORAGE_KEY = "launchdetect_state_v3";

// Change to devnet if you prefer:
// const SOLANA_RPC = "https://api.devnet.solana.com";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const state = {
  route: "home",          // home | how
  view: "all",            // all | filtered | verified

  wallet: {
    connected: false,
    address: null,
    solBalance: null,
  },

  filtered: {
    items: [],
    hiddenCount: 0,
  },
  verified: {
    items: [],
  },
};

function nowMs() { return Date.now(); }
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function toast(msg) {
  UI.toast.textContent = msg;
  UI.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => UI.toast.classList.remove("show"), 2200);
}

function formatCompactUSD(num) {
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

/* ------------------------- Wallet (Phantom) ------------------------- */

function getPhantomProvider() {
  const sol = window?.solana;
  if (sol && sol.isPhantom) return sol;
  return null;
}

async function connectWallet() {
  const provider = getPhantomProvider();
  if (!provider) {
    toast("Phantom not found. Install Phantom to connect.");
    return;
  }

  try {
    const resp = await provider.connect();
    const pubkey = resp?.publicKey?.toString?.() || provider.publicKey?.toString?.();
    if (!pubkey) throw new Error("No public key");

    state.wallet.connected = true;
    state.wallet.address = pubkey;
    state.wallet.solBalance = null;

    saveState();
    syncWalletUI();
    toast("Wallet connected");

    await refreshBalance();
    closeModal();
  } catch {
    toast("Connection cancelled");
  }
}

async function disconnectWallet() {
  const provider = getPhantomProvider();
  try {
    if (provider?.disconnect) await provider.disconnect();
  } catch {
    // ignore
  }
  state.wallet.connected = false;
  state.wallet.address = null;
  state.wallet.solBalance = null;
  saveState();
  syncWalletUI();
}

async function rpc(method, params) {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error("RPC failed");
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

async function refreshBalance() {
  if (!state.wallet.connected || !state.wallet.address) return;
  try {
    const result = await rpc("getBalance", [state.wallet.address]);
    const lamports = result?.value ?? 0;
    state.wallet.solBalance = lamports / 1_000_000_000;
    saveState();
    syncWalletUI();
  } catch {
    state.wallet.solBalance = null;
    saveState();
    syncWalletUI();
  }
}

function syncWalletUI() {
  const connected = state.wallet.connected && !!state.wallet.address;
  UI.statusDot.classList.toggle("on", connected);

  if (!connected) {
    UI.walletLabel.textContent = "Wallet";
    UI.walletAddr.textContent = "Not connected";
    UI.btnConnect.textContent = "Connect Wallet";
    UI.btnConnect.onclick = connectWallet;

    UI.tradeNotice.hidden = false;
    UI.btnConnectInline.onclick = connectWallet;
    return;
  }

  const bal =
    typeof state.wallet.solBalance === "number"
      ? `${state.wallet.solBalance.toFixed(3)} SOL`
      : "… SOL";

  UI.walletLabel.textContent = "Wallet • Balance";
  UI.walletAddr.textContent = `${shortAddr(state.wallet.address)} • ${bal}`;

  UI.btnConnect.textContent = "Connected";
  UI.btnConnect.onclick = disconnectWallet;

  // Requirement: once connected, the inline message disappears entirely
  UI.tradeNotice.hidden = true;
}

/* ------------------------- Modal ------------------------- */

function openModal(message) {
  UI.modalSub.textContent = message || "Connect your Phantom wallet to enable Buy/Sell actions.";
  UI.modalOverlay.hidden = false;
}

function closeModal() {
  UI.modalOverlay.hidden = true;
}

/* ------------------------- Routing ------------------------- */

function parseRoute() {
  const hash = location.hash || "#/";
  const route = hash.replace("#/", "").split("?")[0];
  return route === "how" ? "how" : "home";
}

function renderRoute() {
  if (state.route === "how") {
    UI.homePage.hidden = true;
    UI.howRoot.hidden = false;
    return;
  }
  UI.homePage.hidden = false;
  UI.howRoot.hidden = true;
  renderTable();
}

/* ------------------------- Meme-ish Data ------------------------- */

const MEME_A = [
  "Bonk","Wif","Pepe","Doge","Bobo","Chad","Giga","Frog","Blob","Nyan","Shrek","Yeti",
  "Mog","Rizz","Skibidi","Degen","Ape","Pog","Goon","Goblin","Worm","Toad","Beanz","Snek",
  "Oink","Zonk","Womp","Blep","Zaza","Yeet","Kek","Bingus","Zorple","Glorp","Sploink",
  "Crab","Mayo","Toaster","Cheeto","Gizmo","Doodle","Sausage","Prawn","Tux","Baguette","Pickle"
];

const MEME_B = [
  "inator","Coin","Token","Wagon","Goonz","Factory","Empire","Blaster","Turbo","Deluxe","Ultra","Prime",
  "3000","Max","Flip","Moon","Nuke","Sauce","Fren","Meme","Pouch","Drip","Tape","Punch",
  "Fi","X","Wave","Club","Gang","Stack","Slam","Giga","Soup","Shrimp","Crush","Honk","Smash","Party"
];

const SYMBOL_POOL = [
  "BONK","WIF","PEPE","DOGE","BOBO","CHAD","GIGA","RIZZ","MOG","SNEK","BING","ZAZA","YEET","KEK",
  "GLORP","SPLO","BLOB","TOAD","WORM","GOON","P0G","NYAN","SHRK","YETI","OINK","ZONK","WOMP",
  "PRAWN","PICKL","MAYO","CRAB","BAGU","TOSTR","GIZMO","DOODL"
];

function makeMemeName() {
  const a = pick(MEME_A);
  const b = pick(MEME_B);
  const join = Math.random() < 0.25 ? " " : "";
  return `${a}${join}${b}`.replace(/\s+/g, " ").trim();
}

function makeSymbol() {
  if (Math.random() < 0.72) return pick(SYMBOL_POOL);
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const len = randInt(3, 5);
  let s = "";
  for (let i = 0; i < len; i++) s += letters[randInt(0, letters.length - 1)];
  return s;
}

function base58Random(len = 44) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[randInt(0, alphabet.length - 1)];
  return out;
}

function cryptoRandomId() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

function genToken({ ageMode = "mixed", type = "filtered" } = {}) {
  const isNew =
    ageMode === "new" ? true :
    ageMode === "old" ? false :
    Math.random() < 0.45;

  const cap = isNew ? randFloat(8_000, 45_000) : randFloat(45_000, 1_300_000);
  const liq = cap * randFloat(0.06, 0.22);
  const vol = liq * randFloat(0.2, 2.8);
  const txns = Math.round(clamp(vol / randFloat(80, 220), 12, 4200));

  let listedAt = nowMs();
  if (isNew) listedAt -= randInt(5, 110) * 1000;
  else listedAt -= randInt(10 * 60, 3 * 24 * 60 * 60) * 1000;

  return {
    id: cryptoRandomId(),
    type, // "filtered" | "verified"
    symbol: makeSymbol(),
    name: makeMemeName(),
    marketCap: cap,
    liquidity: liq,
    volume24h: vol,
    txns,
    devWallet: base58Random(44),
    listedAt,
    contract: base58Random(44),
  };
}

function genVerifiedEntry() {
  const t = genToken({ ageMode: "old", type: "verified" });
  t.marketCap = randFloat(120_000, 2_200_000);
  t.liquidity = t.marketCap * randFloat(0.10, 0.28);
  t.volume24h = t.liquidity * randFloat(0.15, 1.8);
  t.txns = Math.round(clamp(t.volume24h / randFloat(120, 260), 30, 5500));
  t.listedAt = nowMs() - randInt(30 * 60, 7 * 24 * 60 * 60) * 1000;
  t.devWallet = base58Random(44);
  return t;
}

/* ------------------------- Persistence ------------------------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (parsed?.route) state.route = parsed.route;
    if (parsed?.view) state.view = parsed.view;

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

/* ------------------------- Rendering ------------------------- */

function badgeHtml(type) {
  // Only green badges, per requirement
  if (type === "verified") return `<span class="badge">Verified ✓</span>`;
  return `<span class="badge">Filtered</span>`;
}

function trackLink(item) {
  // placeholder link; wire to real page later
  const href = `#/?token=${encodeURIComponent(item.contract)}`;
  return `<a class="track-link" href="${href}" title="Track coin data">Track coin data</a>`;
}

function actionsHtml(item) {
  return `
    <div class="actions">
      <button class="action-btn" data-action="buy" data-id="${item.id}">Buy</button>
      <button class="action-btn" data-action="sell" data-id="${item.id}">Sell</button>
    </div>
  `;
}

function rowHtml(item) {
  return `
    <div class="row" data-id="${item.id}">
      <div class="cell">
        <div class="token">
          <div class="sym">${item.symbol} <span style="margin-left:8px;">${badgeHtml(item.type)}</span></div>
          <div class="name">${item.name} • ${shortAddr(item.contract)}</div>
        </div>
      </div>
      <div class="cell">${formatCompactUSD(item.marketCap)}</div>
      <div class="cell">${formatCompactUSD(item.liquidity)}</div>
      <div class="cell">${formatCompactUSD(item.volume24h)}</div>
      <div class="cell">${item.txns.toLocaleString()}</div>
      <div class="cell">${shortAddr(item.devWallet)}</div>
      <div class="cell" data-rel="1">${relTimeFrom(item.listedAt)}</div>
      <div class="cell">${actionsHtml(item)}</div>
      <div class="cell">${trackLink(item)}</div>
    </div>
  `;
}

function getAllItemsSorted() {
  // Merge streams; newest first
  const merged = [...state.filtered.items, ...state.verified.items];
  merged.sort((a, b) => b.listedAt - a.listedAt);
  return merged;
}

function datasetForView() {
  if (state.view === "verified") return [...state.verified.items].sort((a,b)=>b.listedAt-a.listedAt);
  if (state.view === "filtered") return [...state.filtered.items].sort((a,b)=>b.listedAt-a.listedAt);
  return getAllItemsSorted();
}

function renderTabs() {
  UI.tabs.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === state.view);
  });
}

function renderTable() {
  renderTabs();
  syncWalletUI();

  const items = datasetForView();
  UI.listRoot.innerHTML = items.map(rowHtml).join("");

  updateStats();
}

function updateRelTimes() {
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
  const shown = datasetForView().length;
  UI.statShown.textContent = shown.toLocaleString();
  UI.statHidden.textContent = state.filtered.hiddenCount.toLocaleString();
  UI.statVerified.textContent = state.verified.items.length.toLocaleString();
}

/* ------------------------- Seeding + Streams ------------------------- */

function seedAll() {
  state.filtered.items = [];
  state.verified.items = [];
  state.filtered.hiddenCount = randInt(80, 320);

  for (let i = 0; i < 50; i++) {
    const ageMode = i < 16 ? "new" : "old";
    state.filtered.items.push(genToken({ ageMode, type: "filtered" }));
  }

  for (let i = 0; i < 50; i++) {
    state.verified.items.push(genVerifiedEntry());
  }

  state.filtered.items.sort((a, b) => b.listedAt - a.listedAt);
  state.verified.items.sort((a, b) => b.listedAt - a.listedAt);

  saveState();
}

function scheduleFilteredStream() {
  const loop = () => {
    const delay = randInt(1800, 5200);
    setTimeout(() => {
      // blocked rugs increment (not displayed)
      if (Math.random() < 0.22) {
        state.filtered.hiddenCount += 1;
        updateStats();
        loop();
        return;
      }

      const item = genToken({ ageMode: "new", type: "filtered" });
      state.filtered.items.unshift(item);
      state.filtered.items = state.filtered.items.slice(0, 300);

      if (state.route === "home") renderTable();
      else updateStats();

      loop();
    }, delay);
  };
  loop();
}

function scheduleVerifiedStream() {
  const loop = () => {
    const delay = randInt(28_000, 65_000);
    setTimeout(() => {
      const item = genVerifiedEntry();
      state.verified.items.unshift(item);
      state.verified.items = state.verified.items.slice(0, 250);

      if (state.route === "home") renderTable();
      else updateStats();

      loop();
    }, delay);
  };
  loop();
}

/* ------------------------- Events ------------------------- */

UI.tabsWrap.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const view = btn.getAttribute("data-view");
  if (!["all", "filtered", "verified"].includes(view)) return;

  state.view = view;
  saveState();
  if (state.route === "home") renderTable();
});

UI.btnBack.addEventListener("click", () => {
  location.hash = "#/";
});

UI.modalClose.addEventListener("click", closeModal);
UI.modalOverlay.addEventListener("click", (e) => {
  if (e.target === UI.modalOverlay) closeModal();
});
UI.modalConnect.addEventListener("click", connectWallet);

UI.btnConnectInline.addEventListener("click", connectWallet);

// Buy/Sell click delegation
UI.listRoot.addEventListener("click", (e) => {
  const btn = e.target.closest(".action-btn");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const item =
    state.filtered.items.find((x) => x.id === id) ||
    state.verified.items.find((x) => x.id === id);

  if (!item) return;

  if (!state.wallet.connected) {
    openModal(`Connect your Phantom wallet to ${action === "buy" ? "buy" : "sell"} ${item.symbol}.`);
    return;
  }

  // connected behavior (placeholder)
  toast(`${action.toUpperCase()} ${item.symbol} — coming soon`);
});

/* ------------------------- Boot ------------------------- */

(function boot() {
  loadState();

  state.route = parseRoute();
  window.addEventListener("hashchange", () => {
    state.route = parseRoute();
    saveState();
    renderRoute();
  });

  if (!state.filtered.items?.length || !state.verified.items?.length) {
    seedAll();
  }

  // Hydrate if Phantom already connected
  const provider = getPhantomProvider();
  if (provider?.publicKey?.toString?.()) {
    state.wallet.connected = true;
    state.wallet.address = provider.publicKey.toString();
  }

  syncWalletUI();
  renderRoute();
  updateStats();

  setInterval(updateRelTimes, 1000);
  setInterval(refreshBalance, 15_000);

  if (state.wallet.connected) refreshBalance();

  scheduleFilteredStream();
  scheduleVerifiedStream();
})();

UI.btnConnect.addEventListener("click", () => {
  // actual handler is assigned in syncWalletUI
});
