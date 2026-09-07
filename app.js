import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAKZMu2HZPmmoZ1fFT7DNA9Q6ystbKEPgE",
  authDomain: "samnanger-g14-f10a1.firebaseapp.com",
  projectId: "samnanger-g14-f10a1",
  storageBucket: "samnanger-g14-f10a1.firebasestorage.app",
  messagingSenderId: "926427862844",
  appId: "1:926427862844:web:eeb814a349e9bfd701b039"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

const TRACK_LENGTH_M = 400;
const TEST_DURATION_MS = 12 * 60 * 1000;
const FINAL_MARKERS = [0, 100, 200, 300];
const DEFAULT_PLAYERS = [
  "Ask", "Martin", "Brage", "Gabriel", "Sondre", "Nico", "Lars", "Snorre",
  "Sverre", "Liam", "Noah", "Lukas", "Oliver", "Nytveit", "Theodor", "Thage"
];

const ids = [
  "authGate","appRoot","loginForm","loginEmail","loginPassword","loginError","logoutBtn","cloudStatus",
  "setupPanel","livePanel","finishPanel","participantGrid","selectAllBtn","selectNoneBtn","selectedCount",
  "quickAddForm","quickAddInput","testModeToggle","startBtn","liveEyebrow","elapsedClock","livePhaseText",
  "liveClock","clockTrackFill","liveHint","lapCountTotal","undoGlobalBtn","lapGrid","stopEarlyBtn",
  "finalizedCount","finalizedTotal","finishPositionList","finishTestBtn","playerFilter","resultStats",
  "developmentPanel","historyList","rosterAddForm","rosterAddInput","rosterList","resetRosterBtn",
  "countdownOverlay","countdownNumber","countdownText","finishSignalOverlay","toast"
];
const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

let currentUser = null;
let roster = [...DEFAULT_PLAYERS];
let selectedPlayers = new Set(DEFAULT_PLAYERS);
let tests = [];
let liveTest = null;
let lapStack = [];
let timerHandle = null;
let wakeLock = null;
let writeQueue = Promise.resolve();
let toastTimer = null;
let audioCtx = null;
let testMode = false;
let cloudAvailable = true;
let finishTriggered = false;
const tapLocks = new Map();

injectPlayerPicker();

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char]));
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function uniqueNames(names) {
  const seen = new Set();
  return names.filter(name => {
    const clean = normalizeName(name);
    const key = clean.toLocaleLowerCase("nb-NO");
    if (!clean || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatCountdown(ms) {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(ms) {
  if (!ms) return "Ukjent dato";
  return new Intl.DateTimeFormat("nb-NO", { day:"2-digit", month:"short", year:"numeric" }).format(new Date(ms));
}

function formatShortDate(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("nb-NO", { day:"2-digit", month:"2-digit" }).format(new Date(ms));
}

function formatClock(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat("nb-NO", { hour:"2-digit", minute:"2-digit" }).format(new Date(ms));
}

function formatDistance(meters) {
  return Number.isFinite(meters) ? `${Math.round(meters)} m` : "DNF";
}

function cooperVo2(distanceM) {
  if (!Number.isFinite(distanceM)) return null;
  return Math.max(0, (distanceM - 504.9) / 44.73);
}

function setCloudStatus(mode, text = "Firestore") {
  if (!els.cloudStatus) return;
  els.cloudStatus.classList.remove("online", "local");
  if (mode) els.cloudStatus.classList.add(mode);
  const label = els.cloudStatus.querySelector("span");
  if (label) label.textContent = text;
}

function markCloudOnline() {
  cloudAvailable = true;
  setCloudStatus("online", "Lagret");
}

function markCloudLocal() {
  cloudAvailable = false;
  setCloudStatus("local", "Lokal");
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function localKey() {
  return currentUser ? `cooper-live-${currentUser.uid}` : "cooper-live";
}

function saveLocalLive() {
  if (!liveTest || !currentUser) return;
  localStorage.setItem(localKey(), JSON.stringify({ liveTest, lapStack }));
}

function clearLocalLive() {
  if (currentUser) localStorage.removeItem(localKey());
}

function loadLocalLive() {
  if (!currentUser) return null;
  try {
    const raw = localStorage.getItem(localKey());
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.liveTest || !["running","finish"].includes(parsed.liveTest.status)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function loadRoster() {
  setCloudStatus(null, "Laster");
  try {
    const ref = doc(db, "cooperConfig", "team");
    const snap = await getDoc(ref);
    if (snap.exists() && Array.isArray(snap.data().players) && snap.data().players.length) {
      roster = uniqueNames(snap.data().players);
    } else {
      roster = [...DEFAULT_PLAYERS];
      await setDoc(ref, { players: roster, updatedAt: serverTimestamp(), updatedBy: currentUser.uid }, { merge: true });
    }
    selectedPlayers = new Set(roster);
    markCloudOnline();
  } catch (error) {
    console.error("Kunne ikke laste spillerliste", error);
    roster = [...DEFAULT_PLAYERS];
    selectedPlayers = new Set(roster);
    markCloudLocal();
    showToast("Skytilkobling feilet. Appen kan fortsatt brukes lokalt.");
  }
  renderRoster();
  renderParticipantSetup();
}

async function saveRoster() {
  renderRoster();
  renderParticipantSetup();
  try {
    await setDoc(doc(db, "cooperConfig", "team"), {
      players: roster,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    }, { merge: true });
    markCloudOnline();
  } catch (error) {
    console.error("Kunne ikke lagre spillerliste", error);
    markCloudLocal();
    showToast("Spillerlisten ble ikke lagret i Firestore.");
  }
}

async function loadTests() {
  try {
    const q = query(collection(db, "cooperTests"), orderBy("startedAtMs", "desc"), limit(100));
    const snap = await getDocs(q);
    tests = snap.docs.map(item => ({ id:item.id, ...item.data() }));
    markCloudOnline();
  } catch (error) {
    console.error("Kunne ikke laste Cooper-tester", error);
    tests = [];
    markCloudLocal();
    showToast("Kunne ikke hente Cooper-resultatene.");
  }
  renderResults();
}

function enqueueTestSave(snapshot = liveTest) {
  if (!snapshot || !currentUser || snapshot.isTestMode) return Promise.resolve(true);
  const clean = JSON.parse(JSON.stringify(snapshot));
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    setCloudStatus(null, "Lagrer");
    await setDoc(doc(db, "cooperTests", clean.id), {
      ...clean,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser.uid
    }, { merge:true });
    markCloudOnline();
    return true;
  }).catch(error => {
    console.error("Firestore-save feilet", error);
    markCloudLocal();
    showToast("Lagring feilet – aktiv test er fortsatt lagret lokalt.");
    return false;
  });
  return writeQueue;
}

function renderParticipantSetup() {
  selectedPlayers = new Set([...selectedPlayers].filter(name => roster.includes(name)));
  els.participantGrid.innerHTML = roster.map(name => {
    const selected = selectedPlayers.has(name);
    return `<button class="participant-chip ${selected ? "selected" : ""}" data-player="${esc(name)}" type="button"><span>${esc(name)}</span></button>`;
  }).join("");
  els.selectedCount.textContent = selectedPlayers.size;
  els.startBtn.disabled = selectedPlayers.size === 0;
}

function renderRoster() {
  els.rosterList.innerHTML = roster.map(name => `
    <div class="roster-item"><b>${esc(name)}</b><button class="remove-btn" data-remove-player="${esc(name)}" type="button" aria-label="Fjern ${esc(name)}">×</button></div>`
  ).join("");
}

function addPlayer(name, select = true) {
  const clean = normalizeName(name);
  if (!clean) return false;
  const existing = roster.find(item => item.toLocaleLowerCase("nb-NO") === clean.toLocaleLowerCase("nb-NO"));
  if (existing) {
    if (select) selectedPlayers.add(existing);
    renderParticipantSetup();
    showToast(`${clean} finnes allerede.`);
    return false;
  }
  roster.push(clean);
  if (select) selectedPlayers.add(clean);
  saveRoster();
  return true;
}

function playTone(frequency = 520, duration = .12, volume = .04) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
    osc.stop(audioCtx.currentTime + duration);
  } catch {}
}

function playFinishSignal() {
  const pattern = [760, 760, 980];
  pattern.forEach((frequency, index) => setTimeout(() => playTone(frequency, index === 2 ? .55 : .22, .09), index * 310));
  if (navigator.vibrate) navigator.vibrate([250,110,250,110,650]);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function runCountdown() {
  els.countdownOverlay.classList.remove("is-hidden");
  els.countdownText.textContent = testMode ? "TESTMODUS" : "KLAR";
  for (const number of [3,2,1]) {
    els.countdownNumber.textContent = number;
    playTone(450 + number * 45, .09, .04);
    if (navigator.vibrate) navigator.vibrate(35);
    await sleep(1000);
  }
  els.countdownNumber.textContent = "GO";
  els.countdownText.textContent = "12 MINUTTER";
  playTone(900, .3, .07);
  if (navigator.vibrate) navigator.vibrate([80,40,80]);
}

async function startTest() {
  if (liveTest?.status === "running") return;
  const participants = roster.filter(name => selectedPlayers.has(name));
  if (!participants.length) return;
  els.startBtn.disabled = true;
  finishTriggered = false;
  try {
    await runCountdown();
    const startedAtMs = Date.now();
    liveTest = {
      id:`cooper-${startedAtMs}-${Math.random().toString(36).slice(2,8)}`,
      type:"cooper-12",
      status:"running",
      isTestMode:testMode,
      startedAtMs,
      endedAtMs:null,
      durationMs:TEST_DURATION_MS,
      trackLengthM:TRACK_LENGTH_M,
      markerStepM:100,
      createdBy:currentUser.uid,
      createdByEmail:currentUser.email || "",
      participants:participants.map(name => ({
        name, laps:0, finalSegmentM:null, status:"running", totalDistanceM:null
      }))
    };
    lapStack = [];
    saveLocalLive();
    if (!liveTest.isTestMode) enqueueTestSave(liveTest);
    showLivePanel();
    startClock();
    requestWakeLock();
    await sleep(450);
    els.countdownOverlay.classList.add("is-hidden");
    if (liveTest.isTestMode) showToast("TESTMODUS – resultatene lagres ikke permanent.");
  } finally {
    els.startBtn.disabled = false;
  }
}

function showSetupPanel() {
  els.setupPanel.classList.remove("is-hidden");
  els.livePanel.classList.add("is-hidden");
  els.finishPanel.classList.add("is-hidden");
  stopClock();
}

function showLivePanel() {
  els.setupPanel.classList.add("is-hidden");
  els.finishPanel.classList.add("is-hidden");
  els.livePanel.classList.remove("is-hidden");
  renderLive();
}

function showFinishPanel() {
  els.setupPanel.classList.add("is-hidden");
  els.livePanel.classList.add("is-hidden");
  els.finishPanel.classList.remove("is-hidden");
  renderFinishRegistration();
}

function startClock() {
  stopClock();
  const tick = () => {
    if (!liveTest || liveTest.status !== "running") return;
    const elapsed = Date.now() - liveTest.startedAtMs;
    const remaining = TEST_DURATION_MS - elapsed;
    els.liveClock.textContent = formatCountdown(remaining);
    els.elapsedClock.textContent = formatCountdown(remaining);
    els.clockTrackFill.style.width = `${Math.min(100, Math.max(0, elapsed / TEST_DURATION_MS * 100))}%`;
    if (remaining <= 0 && !finishTriggered) triggerFinishSignal();
  };
  tick();
  timerHandle = setInterval(tick, 100);
}

function stopClock() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function totalLapsRegistered() {
  return liveTest?.participants?.reduce((sum, player) => sum + (player.laps || 0), 0) || 0;
}

function renderLive() {
  if (!liveTest) return;
  els.lapCountTotal.textContent = totalLapsRegistered();
  els.undoGlobalBtn.disabled = lapStack.length === 0;
  els.liveHint.textContent = liveTest.isTestMode
    ? "TESTMODUS · Ett trykk på spiller = +400 m. Ingenting lagres permanent."
    : "Ett trykk på spiller = +400 m. Knappene står alltid på samme plass.";
  els.lapGrid.innerHTML = liveTest.participants.map(player => `
    <button class="lap-btn" data-lap-player="${esc(player.name)}" type="button">
      <span class="name">${esc(player.name)}</span>
      <span class="laps">${player.laps}</span>
      <span class="meters">${player.laps * TRACK_LENGTH_M} m registrert</span>
      <span class="undo-mini" data-undo-player="${esc(player.name)}" role="button" aria-label="Trekk fra én runde">−1</span>
    </button>`
  ).join("");
}

function addLap(name) {
  if (!liveTest || liveTest.status !== "running") return;
  const now = Date.now();
  const lockedUntil = tapLocks.get(name) || 0;
  if (now < lockedUntil) return;
  tapLocks.set(name, now + 900);
  const player = liveTest.participants.find(item => item.name === name);
  if (!player) return;
  player.laps += 1;
  lapStack.push({ name, atMs:now });
  saveLocalLive();
  if (!liveTest.isTestMode) enqueueTestSave(liveTest);
  playTone(650, .055, .022);
  if (navigator.vibrate) navigator.vibrate(18);
  renderLive();
  requestAnimationFrame(() => {
    const button = [...els.lapGrid.querySelectorAll("[data-lap-player]")].find(el => el.dataset.lapPlayer === name);
    if (button) {
      button.classList.add("flash");
      setTimeout(() => button.classList.remove("flash"), 500);
    }
  });
}

function undoPlayerLap(name, fromGlobal = false) {
  if (!liveTest || liveTest.status !== "running") return;
  const player = liveTest.participants.find(item => item.name === name);
  if (!player || player.laps <= 0) return;
  player.laps -= 1;
  if (fromGlobal) {
    const index = [...lapStack].map(item => item.name).lastIndexOf(name);
    if (index >= 0) lapStack.splice(index,1);
  } else {
    const index = [...lapStack].map(item => item.name).lastIndexOf(name);
    if (index >= 0) lapStack.splice(index,1);
  }
  saveLocalLive();
  if (!liveTest.isTestMode) enqueueTestSave(liveTest);
  renderLive();
  showToast(`${name}: én runde trukket fra.`);
}

function undoLastLap() {
  if (!liveTest || liveTest.status !== "running" || !lapStack.length) return;
  const last = lapStack.pop();
  const player = liveTest.participants.find(item => item.name === last.name);
  if (!player || player.laps <= 0) return;
  player.laps -= 1;
  saveLocalLive();
  if (!liveTest.isTestMode) enqueueTestSave(liveTest);
  renderLive();
  showToast(`Angret siste passering: ${last.name}.`);
}

async function triggerFinishSignal() {
  if (!liveTest || liveTest.status !== "running" || finishTriggered) return;
  finishTriggered = true;
  stopClock();
  liveTest.status = "finish";
  liveTest.endedAtMs = liveTest.startedAtMs + TEST_DURATION_MS;
  saveLocalLive();
  playFinishSignal();
  els.finishSignalOverlay.classList.remove("is-hidden");
  await sleep(2300);
  els.finishSignalOverlay.classList.add("is-hidden");
  showFinishPanel();
}

async function abortTest() {
  if (!liveTest || !["running","finish"].includes(liveTest.status)) return;
  const ok = confirm("Avbryte Cooper-testen? Denne testøkten blir ikke brukt som resultat.");
  if (!ok) return;
  stopClock();
  const wasSaved = !liveTest.isTestMode;
  const testId = liveTest.id;
  clearLocalLive();
  await releaseWakeLock();
  liveTest = null;
  lapStack = [];
  finishTriggered = false;
  showSetupPanel();
  if (wasSaved) {
    try { await deleteDoc(doc(db,"cooperTests",testId)); } catch (error) { console.warn("Kunne ikke rydde avbrutt test", error); }
  }
  showToast("Testen er avbrutt.");
}

function isFinalized(player) {
  return player.status === "finished" || player.status === "dnf";
}

function setFinalMarker(name, segmentM) {
  if (!liveTest || liveTest.status !== "finish") return;
  const player = liveTest.participants.find(item => item.name === name);
  if (!player) return;
  player.status = "finished";
  player.finalSegmentM = segmentM;
  player.totalDistanceM = player.laps * TRACK_LENGTH_M + segmentM;
  saveLocalLive();
  renderFinishRegistration();
}

function setDNF(name) {
  if (!liveTest || liveTest.status !== "finish") return;
  const player = liveTest.participants.find(item => item.name === name);
  if (!player) return;
  if (player.status === "dnf") {
    player.status = "running";
    player.finalSegmentM = null;
    player.totalDistanceM = null;
  } else {
    player.status = "dnf";
    player.finalSegmentM = null;
    player.totalDistanceM = null;
  }
  saveLocalLive();
  renderFinishRegistration();
}

function renderFinishRegistration() {
  if (!liveTest) return;
  const finalized = liveTest.participants.filter(isFinalized).length;
  els.finalizedCount.textContent = finalized;
  els.finalizedTotal.textContent = `/ ${liveTest.participants.length} ferdig`;
  els.finishTestBtn.disabled = finalized !== liveTest.participants.length;
  els.finishTestBtn.textContent = liveTest.isTestMode ? "AVSLUTT TESTMODUS" : "LAGRE RESULTATER";

  els.finishPositionList.innerHTML = liveTest.participants.map(player => {
    const base = player.laps * TRACK_LENGTH_M;
    const done = isFinalized(player);
    const markerHtml = FINAL_MARKERS.map(marker => `
      <button class="marker-btn ${player.status === "finished" && player.finalSegmentM === marker ? "active" : ""}" data-final-player="${esc(player.name)}" data-marker="${marker}" type="button">+${marker}</button>`
    ).join("");
    return `<div class="finish-row ${done ? "done" : ""}">
      <div class="finish-person"><strong>${esc(player.name)}</strong><span>${player.laps} runder · ${base} m</span></div>
      <div class="marker-buttons">${markerHtml}</div>
      <div class="final-distance"><strong>${player.status === "finished" ? formatDistance(player.totalDistanceM) : player.status === "dnf" ? "DNF" : "—"}</strong><span>sluttdistanse</span></div>
      <button class="dnf-btn" data-dnf-player="${esc(player.name)}" type="button">${player.status === "dnf" ? "ANGRE DNF" : "DNF"}</button>
    </div>`;
  }).join("");
}

async function completeTest() {
  if (!liveTest || liveTest.status !== "finish") return;
  if (liveTest.participants.some(player => !isFinalized(player))) return;
  const completed = JSON.parse(JSON.stringify({ ...liveTest, status:"completed" }));

  if (completed.isTestMode) {
    clearLocalLive();
    await releaseWakeLock();
    liveTest = null;
    lapStack = [];
    finishTriggered = false;
    showSetupPanel();
    showToast("Testmodus avsluttet – ingen resultater ble lagret.");
    return;
  }

  const saved = await enqueueTestSave(completed);
  if (!saved) {
    showToast("Kunne ikke bekrefte lagring. Lokal sikkerhetskopi beholdes.");
    return;
  }
  clearLocalLive();
  await releaseWakeLock();
  liveTest = null;
  lapStack = [];
  finishTriggered = false;
  showSetupPanel();
  await loadTests();
  navigate("results");
  showToast("Cooper-resultatene er lagret.");
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && liveTest && ["running","finish"].includes(liveTest.status)) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (error) {
    console.warn("Wake Lock ikke tilgjengelig", error);
  }
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
}

function calculatePBs() {
  const pbs = new Map();
  for (const test of tests) {
    for (const player of test.participants || []) {
      if (player.status !== "finished" || !Number.isFinite(player.totalDistanceM)) continue;
      const key = player.name.toLocaleLowerCase("nb-NO");
      const current = pbs.get(key);
      if (!current || player.totalDistanceM > current.distanceM) {
        pbs.set(key, { distanceM:player.totalDistanceM, name:player.name, testId:test.id });
      }
    }
  }
  return pbs;
}

function selectedFilterName() {
  return els.playerFilter?.value || "";
}

function filteredTests() {
  const player = selectedFilterName();
  if (!player) return tests;
  return tests.filter(test => (test.participants || []).some(item => item.name === player));
}

function renderPlayerFilter() {
  const current = selectedFilterName();
  const names = uniqueNames([
    ...roster,
    ...tests.flatMap(test => (test.participants || []).map(item => item.name))
  ]).sort((a,b) => a.localeCompare(b,"nb-NO"));
  els.playerFilter.innerHTML = `<option value="">Alle</option>${names.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}`;
  if (names.includes(current)) els.playerFilter.value = current;
  syncCustomPlayerPicker(names);
}

function getPlayerSeries(playerName) {
  return tests.map(test => {
    const player = (test.participants || []).find(item => item.name === playerName);
    if (!player || player.status !== "finished" || !Number.isFinite(player.totalDistanceM)) return null;
    return { testId:test.id, dateMs:test.startedAtMs, distanceM:player.totalDistanceM };
  }).filter(Boolean).sort((a,b) => a.dateMs - b.dateMs);
}

function renderDevelopmentChart(playerName) {
  const panel = els.developmentPanel;
  if (!playerName) {
    panel.classList.add("is-hidden");
    panel.innerHTML = "";
    return;
  }
  const series = getPlayerSeries(playerName);
  panel.classList.remove("is-hidden");
  if (!series.length) {
    panel.innerHTML = `<p class="eyebrow">PLAYER TREND</p><h3>${esc(playerName)}</h3><div class="empty-state">Ingen fullførte Cooper-tester ennå.</div>`;
    return;
  }
  const first = series[0].distanceM;
  const latest = series.at(-1).distanceM;
  const pb = Math.max(...series.map(item => item.distanceM));
  const change = latest - first;
  const width = 760, height = 270;
  const pad = { left:58, right:24, top:34, bottom:48 };
  const values = series.map(item => item.distanceM);
  let minY = Math.min(...values), maxY = Math.max(...values);
  const spread = Math.max(200, maxY - minY);
  minY = Math.max(0, Math.floor((minY - spread * .25) / 100) * 100);
  maxY = Math.ceil((maxY + spread * .25) / 100) * 100;
  if (minY === maxY) maxY = minY + 400;
  const plotW = width-pad.left-pad.right, plotH = height-pad.top-pad.bottom;
  const xFor = i => series.length === 1 ? pad.left+plotW/2 : pad.left+(i/(series.length-1))*plotW;
  const yFor = value => pad.top+((maxY-value)/(maxY-minY))*plotH;
  const points = series.map((item,i) => ({ ...item, x:xFor(i), y:yFor(item.distanceM) }));
  const path = points.map((p,i) => `${i?"L":"M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = series.length > 1 ? `${path} L${points.at(-1).x},${pad.top+plotH} L${points[0].x},${pad.top+plotH} Z` : "";
  const grids = Array.from({length:5},(_,i) => {
    const value = maxY-((maxY-minY)*i/4); const y = yFor(value);
    return `<line class="chart-grid" x1="${pad.left}" y1="${y}" x2="${width-pad.right}" y2="${y}"/><text class="chart-axis" x="${pad.left-9}" y="${y+3}" text-anchor="end">${Math.round(value)}m</text>`;
  }).join("");
  const pointSvg = points.map((p,i) => `<g><circle class="chart-point ${i===points.length-1?"latest":""}" cx="${p.x}" cy="${p.y}" r="7"/><text class="chart-value" x="${p.x}" y="${Math.max(14,p.y-13)}">${p.distanceM}m</text><text class="chart-date" x="${p.x}" y="${height-18}">${formatShortDate(p.dateMs)}</text></g>`).join("");
  panel.innerHTML = `
    <p class="eyebrow">PLAYER TREND</p><h3>${esc(playerName)}</h3>
    <div class="development-kpis">
      <div class="development-kpi"><span>Siste</span><strong>${latest} m</strong></div>
      <div class="development-kpi"><span>PB</span><strong>${pb} m</strong></div>
      <div class="development-kpi"><span>Fra første</span><strong>${change>0?"+":""}${change} m</strong></div>
    </div>
    <div class="chart-shell"><svg class="development-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Utviklingsgraf for ${esc(playerName)}">
      <defs><linearGradient id="cooperArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#63f2c4" stop-opacity=".20"/><stop offset="1" stop-color="#63f2c4" stop-opacity="0"/></linearGradient></defs>
      ${grids}${area?`<path class="chart-area" d="${area}"/>`:""}${series.length>1?`<path class="chart-line" d="${path}"/>`:""}${pointSvg}
    </svg></div>`;
}

function renderResults() {
  renderPlayerFilter();
  const pbs = calculatePBs();
  const viewTests = filteredTests();
  const selected = selectedFilterName();
  const finished = viewTests.flatMap(test => (test.participants || []).filter(player => player.status === "finished" && Number.isFinite(player.totalDistanceM) && (!selected || player.name === selected)));
  const best = finished.length ? Math.max(...finished.map(player => player.totalDistanceM)) : null;
  const average = finished.length ? Math.round(finished.reduce((sum,player) => sum+player.totalDistanceM,0)/finished.length) : null;
  const vo2 = best ? cooperVo2(best) : null;
  els.resultStats.innerHTML = `
    <div class="stat-card"><span>${selected?"Personlig rekord":"Beste registrert"}</span><strong>${best?`${best} m`:"—"}</strong><small>${selected?esc(selected):"Alle tester"}</small></div>
    <div class="stat-card"><span>${selected?"Tester":"Testøkter"}</span><strong>${viewTests.length}</strong><small>lagret</small></div>
    <div class="stat-card"><span>${selected?"VO₂-estimat (PB)":"Snitt"}</span><strong>${selected&&vo2?vo2.toFixed(1):average?`${average} m`:"—"}</strong><small>${selected?"ml/kg/min":`${finished.length} fullføringer`}</small></div>`;
  renderDevelopmentChart(selected);
  if (!viewTests.length) {
    els.historyList.innerHTML = `<div class="empty-state"><strong>Ingen tester ennå</strong>Start en Cooper-test, så bygges historikken automatisk.</div>`;
    return;
  }
  els.historyList.innerHTML = viewTests.map(test => {
    let rows = [...(test.participants || [])];
    if (selected) rows = rows.filter(item => item.name === selected);
    rows.sort((a,b) => (b.totalDistanceM || -1) - (a.totalDistanceM || -1));
    const completed = rows.filter(player => player.status === "finished" && Number.isFinite(player.totalDistanceM));
    const bestHere = completed.length ? Math.max(...completed.map(player => player.totalDistanceM)) : null;
    const rowHtml = rows.map(player => {
      const pbEntry = pbs.get(player.name.toLocaleLowerCase("nb-NO"));
      const isPB = player.status === "finished" && pbEntry?.distanceM === player.totalDistanceM;
      const vo2Value = player.status === "finished" ? cooperVo2(player.totalDistanceM) : null;
      return `<div class="result-row">
        <div><div class="name">${esc(player.name)}</div><div class="meta">${player.status === "dnf" ? "Ikke fullført" : `${player.laps} runder + ${player.finalSegmentM || 0} m${isPB?" · ★ PB":""}`}</div></div>
        <div class="result-distance">${formatDistance(player.totalDistanceM)}</div>
        <div class="result-vo2"><b>${vo2Value?vo2Value.toFixed(1):"—"}</b><span>VO₂ est.</span></div>
      </div>`;
    }).join("");
    return `<article class="test-card" data-test-id="${esc(test.id)}">
      <header class="test-card-head">
        <div><h3>${formatDate(test.startedAtMs)}</h3><p>Start ${formatClock(test.startedAtMs)} · ${test.participants?.length || 0} deltakere</p></div>
        <div class="test-summary"><b>${bestHere?`${bestHere} m`:"DNF"}</b><span>beste distanse</span></div>
        <button class="delete-test-btn" data-delete-test="${esc(test.id)}" type="button">SLETT TEST</button>
      </header>
      <div>${rowHtml}</div>
    </article>`;
  }).join("");
}

async function deleteTest(testId) {
  const test = tests.find(item => item.id === testId);
  if (!test) return;
  if (!confirm(`Slette Cooper-testen fra ${formatDate(test.startedAtMs)}? Dette kan ikke angres.`)) return;
  try {
    await deleteDoc(doc(db,"cooperTests",testId));
    tests = tests.filter(item => item.id !== testId);
    markCloudOnline();
    renderResults();
    showToast("Testen er slettet.");
  } catch (error) {
    console.error("Kunne ikke slette test", error);
    markCloudLocal();
    showToast("Kunne ikke slette testen fra Firestore.");
  }
}

function injectPlayerPicker() {
  const label = els.playerFilter?.closest("label");
  if (!label || document.getElementById("customPlayerPicker")) return;
  els.playerFilter.style.display = "none";
  const wrap = document.createElement("div");
  wrap.id = "customPlayerPicker";
  wrap.className = "custom-player-picker";
  wrap.innerHTML = `<button id="playerPickerButton" class="player-picker-button" type="button"><span id="playerPickerLabel">Alle</span><b>⌄</b></button><div id="playerPickerMenu" class="player-picker-menu is-hidden"></div>`;
  label.appendChild(wrap);
  const style = document.createElement("style");
  style.textContent = `.custom-player-picker{position:relative}.player-picker-button{display:flex;align-items:center;justify-content:space-between;gap:15px;width:100%;min-height:50px;padding:0 14px;border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.045);color:var(--text);font-weight:850}.player-picker-menu{position:absolute;right:0;top:56px;z-index:80;width:min(310px,86vw);max-height:390px;overflow:auto;padding:7px;border:1px solid rgba(255,255,255,.12);border-radius:17px;background:#10231b;box-shadow:0 22px 55px rgba(0,0,0,.55)}.player-picker-option{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:46px;padding:0 12px;border:0;border-radius:12px;background:transparent;color:#dce8e2;text-align:left;font-weight:800}.player-picker-option.active{background:rgba(201,255,69,.11);color:var(--lime)}.player-picker-option:active{background:rgba(99,242,196,.10)}`;
  document.head.appendChild(style);
  document.getElementById("playerPickerButton").addEventListener("click", event => {
    event.stopPropagation();
    document.getElementById("playerPickerMenu").classList.toggle("is-hidden");
  });
  document.addEventListener("click", () => document.getElementById("playerPickerMenu")?.classList.add("is-hidden"));
  document.getElementById("playerPickerMenu").addEventListener("click", event => {
    event.stopPropagation();
    const button = event.target.closest("[data-filter-player]");
    if (!button) return;
    els.playerFilter.value = button.dataset.filterPlayer;
    document.getElementById("playerPickerMenu").classList.add("is-hidden");
    renderResults();
  });
}

function syncCustomPlayerPicker(names) {
  const menu = document.getElementById("playerPickerMenu");
  const label = document.getElementById("playerPickerLabel");
  if (!menu || !label) return;
  const selected = selectedFilterName();
  label.textContent = selected || "Alle";
  menu.innerHTML = [`<button class="player-picker-option ${!selected?"active":""}" data-filter-player="" type="button"><span>Alle</span>${!selected?"<b>✓</b>":""}</button>`,
    ...names.map(name => `<button class="player-picker-option ${selected===name?"active":""}" data-filter-player="${esc(name)}" type="button"><span>${esc(name)}</span>${selected===name?"<b>✓</b>":""}</button>`)
  ].join("");
}

function navigate(viewName) {
  if (liveTest && ["running","finish"].includes(liveTest.status) && viewName !== "test") {
    showToast("Cooper-testen pågår – fullfør eller avbryt den først.");
    return;
  }
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${viewName}`));
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.nav === viewName));
  if (viewName === "results") renderResults();
  if (viewName === "players") renderRoster();
  window.scrollTo({ top:0, behavior:"smooth" });
}

async function bootForUser(user) {
  currentUser = user;
  els.authGate.classList.add("is-hidden");
  els.appRoot.classList.remove("is-hidden");
  await loadRoster();
  await loadTests();
  const restored = loadLocalLive();
  if (restored) {
    liveTest = restored.liveTest;
    lapStack = Array.isArray(restored.lapStack) ? restored.lapStack : [];
    testMode = !!liveTest.isTestMode;
    els.testModeToggle.checked = testMode;
    if (liveTest.status === "running") {
      const remaining = TEST_DURATION_MS - (Date.now() - liveTest.startedAtMs);
      if (remaining <= 0) {
        finishTriggered = false;
        triggerFinishSignal();
      } else {
        showLivePanel();
        startClock();
        requestWakeLock();
        showToast("Aktiv Cooper-test ble gjenopprettet.");
      }
    } else {
      finishTriggered = true;
      showFinishPanel();
      requestWakeLock();
      showToast("Sluttregistreringen ble gjenopprettet.");
    }
  } else {
    showSetupPanel();
  }
}

els.loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  els.loginError.textContent = "";
  const button = els.loginForm.querySelector("button");
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, els.loginEmail.value.trim(), els.loginPassword.value);
  } catch (error) {
    console.error(error);
    els.loginError.textContent = "Innlogging feilet. Kontroller e-post og passord.";
  } finally { button.disabled = false; }
});

els.logoutBtn.addEventListener("click", async () => {
  if (liveTest && ["running","finish"].includes(liveTest.status)) {
    showToast("Avslutt testen før du logger ut.");
    return;
  }
  await signOut(auth);
});

els.cloudStatus.addEventListener("click", () => showToast(cloudAvailable ? "Firestore er tilkoblet. Resultater lagres i skyen." : "Lokal modus: appen virker, men Firestore-lagring er ikke bekreftet."));

els.participantGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-player]");
  if (!button) return;
  const name = button.dataset.player;
  selectedPlayers.has(name) ? selectedPlayers.delete(name) : selectedPlayers.add(name);
  renderParticipantSetup();
});
els.selectAllBtn.addEventListener("click", () => { selectedPlayers = new Set(roster); renderParticipantSetup(); });
els.selectNoneBtn.addEventListener("click", () => { selectedPlayers.clear(); renderParticipantSetup(); });
els.quickAddForm.addEventListener("submit", event => {
  event.preventDefault(); const name = normalizeName(els.quickAddInput.value);
  if (addPlayer(name,true)) { els.quickAddInput.value=""; showToast(`${name} lagt til.`); }
});
els.testModeToggle.addEventListener("change", event => {
  testMode = event.target.checked;
  showToast(testMode ? "Testmodus på – neste test lagres ikke." : "Testmodus av – neste test lagres.");
});

els.rosterAddForm.addEventListener("submit", event => {
  event.preventDefault(); const name = normalizeName(els.rosterAddInput.value);
  if (addPlayer(name,true)) { els.rosterAddInput.value=""; showToast(`${name} lagt til.`); }
});
els.rosterList.addEventListener("click", event => {
  const button = event.target.closest("[data-remove-player]"); if (!button) return;
  const name = button.dataset.removePlayer;
  if (!confirm(`Fjerne ${name} fra spillerlisten? Historiske resultater beholdes.`)) return;
  roster = roster.filter(item => item !== name); selectedPlayers.delete(name); saveRoster();
});
els.resetRosterBtn.addEventListener("click", () => {
  if (!confirm("Tilbakestille spillerlisten til standardtroppen for G14? Historiske resultater beholdes.")) return;
  roster=[...DEFAULT_PLAYERS]; selectedPlayers=new Set(roster); saveRoster(); showToast("Standardtroppen er gjenopprettet.");
});

els.startBtn.addEventListener("click", startTest);
els.lapGrid.addEventListener("click", event => {
  const undo = event.target.closest("[data-undo-player]");
  if (undo) { event.preventDefault(); event.stopPropagation(); undoPlayerLap(undo.dataset.undoPlayer); return; }
  const button = event.target.closest("[data-lap-player]");
  if (button) addLap(button.dataset.lapPlayer);
});
els.undoGlobalBtn.addEventListener("click", undoLastLap);
els.stopEarlyBtn.addEventListener("click", abortTest);
els.finishPositionList.addEventListener("click", event => {
  const marker = event.target.closest("[data-final-player]");
  if (marker) { setFinalMarker(marker.dataset.finalPlayer, Number(marker.dataset.marker)); return; }
  const dnf = event.target.closest("[data-dnf-player]");
  if (dnf) setDNF(dnf.dataset.dnfPlayer);
});
els.finishTestBtn.addEventListener("click", completeTest);
els.playerFilter.addEventListener("change", renderResults);
els.historyList.addEventListener("click", event => {
  const button = event.target.closest("[data-delete-test]"); if (button) deleteTest(button.dataset.deleteTest);
});
document.querySelectorAll("[data-nav]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.nav)));

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && liveTest && ["running","finish"].includes(liveTest.status) && !wakeLock) requestWakeLock();
});
window.addEventListener("beforeunload", event => {
  if (liveTest && ["running","finish"].includes(liveTest.status)) { event.preventDefault(); event.returnValue=""; }
});

onAuthStateChanged(auth, user => {
  if (user) bootForUser(user);
  else {
    currentUser=null; liveTest=null; lapStack=[]; stopClock(); releaseWakeLock();
    els.appRoot.classList.add("is-hidden"); els.authGate.classList.remove("is-hidden"); setCloudStatus(null,"Firestore");
  }
});
