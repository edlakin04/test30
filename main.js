// LaunchDetect UI
// - Phantom connect wallet button (real connection only)
// - Shows wallet + SOL balance
// - Tabs below info (Filtered / Verified)
// - How it works page with back button
// - Meme-ish token generator + streaming updates
// - Dev column uses wallet addresses (shortened)
// - Row includes small "Track coin data" button

const $ = (sel) => document.querySelector(sel);

const UI = {
  pageTitle: $("#pageTitle"),
  listRoot: $("#listRoot"),
  searchInput: $("#searchInput"),
  btnRefresh: $("#btnRefresh"),

  tabsWrap: $("#tabs"),
  tabs: Array.from(document.querySelectorAll(".tab")),

  btnConnect: $("#btnConnect"),
  btnConnectInline: $("#btnConnectInline"),
  walletAddr: $("#walletAddr"),
  walletLabel: $("#walletLabel"),
  statusDot: $("#statusDot"),

  tradeNotice: $("#tradeNotice"),

  statFiltered: $("#statFiltered"),
  statHidden: $("#statHidden"),
  statVerified: $("#statVerified"),

  howRoot: $("#howRoot"),
  btnBack: $("#btnBack"),

  toast: $("#toast"),
};

const STORAGE_KEY = "launchdetect_state_v2";

// You can change this to devnet if you want for testing:
// const SOLANA_RPC = "https://api.devnet.solana.com";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

const state = {
  route: "home", // home | how
  view: "filtered", // filtered | verified

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
    const pubkey =
      resp?.publicKey?.toString?.() ||
      provider.publicKey?.toString?.();

    if (!pubkey) throw new Error("No public key");

    state.wallet.connected = true;
    state.wallet.address = pubkey;
    state.wallet.solBalance = null;

    saveState();
    syncWalletUI();
    toast("Wallet connected");

    await refreshBalance();
  } catch (e) {
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
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
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
    const sol = lamports / 1_000_000_000;
    state.wallet.solBalance = sol;
    saveState();
    syncWalletUI();
  } catch {
    // Don't spam toast for transient RPC issues
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
  // allow click to disconnect (handy for dev testing)
  UI.btnConnect.onclick = disconnectWallet;

  UI.tradeNotice.hidden = true;
}

/* ------------------------- Routing ------------------------- */

function parseRoute() {
  const hash = location.hash || "#/";
  const route = hash.replace("#/", "").split("?")[0];
  if (route === "how") return { route: "how" };
  return { route: "home" };
}

function setRoute(r) {
  state.route = r;
  saveState();
  render();
}

window.addEventListener("hashchange", () => {
  const r = parseRoute();
  setRoute(r.route);
});

/* ------------------------- Fake Data (meme-ish) ------------------------- */

const MEME_A = [
  "Bonk","Wif","Pepe","Doge","Bobo","Chad","Giga","Frog","Blob","Nyan","Shrek","Yeti",
  "Mog","Rizz","Skibidi","Degen","Ape","Pog","Goon","Goblin","Worm","Toad","Beanz","Snek",
  "Oink","Zonk","Womp","Blep","Zaza","Yeet","Coom","Kek","Bingus","Zorple","Glorp","Sploink",
];

const MEME_B = [
  "inator","Coin","Token","Wagon","Goonz","Factory","Empire","Blaster","Turbo","Deluxe","Ultra","Prime",
  "3000","Max","Flip","RugStop","Moon","Nuke","Sauce","Fren","Meme","Pouch","Drip","Tape","Punch",
  "Fi","X","Wave","Club","Gang","Stack","Slam","Giga","Goblins","Soup","Bonsai","Shrimp",
];

const SYMBOL_POOL = [
  "BONK","WIF","PEPE","DOGE","BOBO","CHAD","GIGA","RIZZ","MOG","SNEK","BING","ZAZA","YEET","KEK",
  "GLORP","SPLO","BLOB","TOAD","WORM","GOON","P0G","NYAN","SHRK","YETI","OINK","ZONK","WOMP",
];

function makeMemeName() {
  // Heavily meme leaning: A + B with occasional weird spacing
  const a = pick(MEME_A);
  const b = pick(MEME_B);
  const join = Math.random() < 0.25 ? " " : "";
  return `${a}${join}${b}`.replace(/\s+/g, " ").trim();
}

function makeSymbol() {
  if (Math.random() < 0.7) return pick(SYMBOL_POOL);
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

function makeRiskBadge(isVerifiedPage = false) {
  const r = Math.random();
  if (isVerifiedPage) {
    if (r < 0.82) return { kind: "ok", label: "Verified" };
    if (r < 0.95) return { kind: "warn", label: "Watch" };
    return { kind: "danger", label: "Flag" };
  }
  if (r < 0.62) return { kind: "ok", label: "Pass" };
  if (r < 0.88) return { kind: "warn", label: "Caution" };
  return { kind: "danger", label: "Flag" };
}

function genToken({ ageMode = "mixed" } = {}) {
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

  const name = makeMemeName();
  const sym = makeSymbol();

  return {
    id: cryptoRandomId(),
    symbol: sym,
    name,
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
  const t = genToken({ ageMode: "old" });
  t.marketCap = randFloat(120_000, 2_200_000);
  t.liquidity = t.marketCap * randFloat(0.10, 0.28);
  t.volume24h = t.liquidity * randFloat(0.15, 1.8);
  t.txns = Math.round(clamp(t.volume24h / randFloat(120, 260), 30, 5500));
  t.listedAt = nowMs() - randInt(30 * 60, 7 * 24 * 60 * 60) * 1000;
  // Verified dev "identity" as a wallet
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

function badgeHtml(b) {
  return `<span class="badge ${b.kind}">${b.label}</span>`;
}

function trackLink(item) {
  // placeholder link (you can wire to internal token page later)
  const href = `#/?token=${encodeURIComponent(item.contract)}`;
  return `<a class="track-link" href="${href}" title="Track coin data">Track coin data</a>`;
}

function rowHtml(item, viewKind) {
  const badge = makeRiskBadge(viewKind === "verified");
  const listed = relTimeFrom(item.listedAt);
  const devShort = shortAddr(item.devWallet);

  return `
    <div class="row" data-id="${item.id}">
      <div class="cell">
        <div class="token">
          <div class="sym">${item.symbol} <span style="margin-left:8px;">${badgeHtml(badge)}</span></div>
          <div class="name">${item.name} • ${shortAddr(item.contract)}</div>
        </div>
      </div>
      <div class="cell">${formatCompactUSD(item.marketCap)}</div>
      <div class="cell">${formatCompactUSD(item.liquidity)}</div>
      <div class="cell">${formatCompactUSD(item.volume24h)}</div>
      <div class="cell">${item.txns.toLocaleString()}</div>
      <div class="cell">${devShort}</div>
      <div class="cell" data-rel="1">${listed}</div>
      <div class="cell">${trackLink(item)}</div>
    </div>
  `;
}

function currentDataset() {
  return state.view === "verified" ? state.verified.items : state.filtered.items;
}

function renderTabs() {
  UI.tabs.forEach((btn) => {
    const r = btn.getAttribute("data-route");
    btn.classList.toggle("active", r === state.view);
  });

  UI.pageTitle.textContent =
    state.view === "verified" ? "Verified Developers" : "Filtered Developers";
}

function renderHome() {
  UI.howRoot.hidden = true;
  document.querySelector(".page").hidden = false;

  renderTabs();
  syncWalletUI();

  const q = (UI.searchInput.value || "").trim().toLowerCase();
  const items = currentDataset();

  const filtered = !q
    ? items
    : items.filter((x) => {
        return (
          String(x.symbol).toLowerCase().includes(q) ||
          String(x.name).toLowerCase().includes(q) ||
          String(x.devWallet).toLowerCase().includes(q)
        );
      });

  UI.listRoot.innerHTML = filtered.map((item) => rowHtml(item, state.view)).join("");
  updateStats();
}

function renderHow() {
  document.querySelector(".page").hidden = true;
  UI.howRoot.hidden = false;
}

function render() {
  if (state.route === "how") renderHow();
  else renderHome();
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
  UI.statFiltered.textContent = state.filtered.items.length.toLocaleString();
  UI.statHidden.textContent = state.filtered.hiddenCount.toLocaleString();
  UI.statVerified.textContent = state.verified.items.length.toLocaleString();
}

/* ------------------------- Initial Data Seeding ------------------------- */

function seedAll() {
  state.filtered.items = [];
  state.verified.items = [];
  state.filtered.hiddenCount = randInt(80, 320);

  for (let i = 0; i < 50; i++) {
    const ageMode = i < 16 ? "new" : "old";
    state.filtered.items.push(genToken({ ageMode }));
  }

  for (let i = 0; i < 50; i++) {
    state.verified.items.push(genVerifiedEntry());
  }

  state.filtered.items.sort((a, b) => b.listedAt - a.listedAt);
  state.verified.items.sort((a, b) => b.listedAt - a.listedAt);

  saveState();
}

/* ------------------------- Live Streams ------------------------- */

function scheduleFilteredStream() {
  const loop = () => {
    const delay = randInt(1800, 5200);
    setTimeout(() => {
      // Sometimes block a rug (not shown)
      if (Math.random() < 0.22) {
        state.filtered.hiddenCount += 1;
        updateStats();
        loop();
        return;
      }

      const item = genToken({ ageMode: "new" });
      state.filtered.items.unshift(item);
      state.filtered.items = state.filtered.items.slice(0, 300);

      if (state.route === "home" && state.view === "filtered") renderHome();
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

      if (state.route === "home" && state.view === "verified") renderHome();
      else updateStats();

      loop();
    }, delay);
  };
  loop();
}

/* ------------------------- Events ------------------------- */

UI.btnConnect.addEventListener("click", (e) => {
  // Click handler is assigned dynamically in syncWalletUI (connect/disconnect)
  // This keeps this listener harmless
});

UI.btnConnectInline.addEventListener("click", () => {
  // set dynamically in syncWalletUI, but safe to keep
});

UI.btnRefresh.addEventListener("click", () => {
  seedAll();
  render();
  toast("Updated feed");
});

UI.searchInput.addEventListener("input", () => render());

UI.tabsWrap.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  const r = btn.getAttribute("data-route");
  if (r !== "filtered" && r !== "verified") return;

  state.view = r;
  saveState();
  renderHome();
});

UI.btnBack.addEventListener("click", () => {
  location.hash = "#/";
});

/* ------------------------- Boot ------------------------- */

(function boot() {
  loadState();

  if (!state.filtered.items?.length || !state.verified.items?.length) {
    seedAll();
  }

  const r = parseRoute();
  state.route = r.route;

  // If Phantom is already connected, try to hydrate state
  const provider = getPhantomProvider();
  if (provider?.publicKey?.toString?.()) {
    state.wallet.connected = true;
    state.wallet.address = provider.publicKey.toString();
  }

  syncWalletUI();
  render();
  updateStats();

  setInterval(updateRelTimes, 1000);
  setInterval(refreshBalance, 15_000);

  if (state.wallet.connected) refreshBalance();

  scheduleFilteredStream();
  scheduleVerifiedStream();
})();
