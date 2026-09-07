const APP_URL = '/app.js?v=20260908-1';

const response = await fetch(APP_URL, { cache: 'no-store' });
if (!response.ok) throw new Error(`Kunne ikke laste app.js: HTTP ${response.status}`);

const source = await response.text();

function precisionFinishExtension() {
  const list = els.finishPositionList;
  if (!list) return;

  const style = document.createElement('style');
  style.textContent = `
    .marker-buttons{flex-wrap:wrap;align-items:center}
    .exact-finish{display:flex;align-items:center;gap:5px;margin-left:4px}
    .exact-finish input{width:68px;height:40px;border:1px solid rgba(95,230,255,.28);border-radius:12px;background:rgba(95,230,255,.06);color:var(--text);padding:0 9px;text-align:center;font-weight:900;outline:none}
    .exact-finish input:focus{border-color:rgba(95,230,255,.7);box-shadow:0 0 0 3px rgba(95,230,255,.08)}
    .exact-finish span{color:var(--muted);font-size:10px;font-weight:900}
    .exact-finish button{height:40px;min-width:40px;border:1px solid rgba(99,242,196,.35);border-radius:12px;background:rgba(99,242,196,.08);color:var(--mint);font-weight:950;cursor:pointer}
    .exact-finish.active input{border-color:rgba(201,255,69,.55);background:rgba(201,255,69,.08);color:var(--text)}
    @media(max-width:760px){.finish-row{grid-template-columns:1fr}.marker-buttons{justify-content:flex-start}.final-distance{text-align:left}.exact-finish{margin-left:0}}
  `;
  document.head.appendChild(style);

  function applyExact(name, rawValue) {
    if (!liveTest || liveTest.status !== 'finish') return;
    const player = liveTest.participants.find(item => item.name === name);
    if (!player) return;

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      showToast('Skriv inn meter mellom 0 og 399.');
      return;
    }

    const segmentM = Math.max(0, Math.min(399, Math.round(parsed)));
    player.status = 'finished';
    player.finalSegmentM = segmentM;
    player.totalDistanceM = player.laps * TRACK_LENGTH_M + segmentM;
    saveLocalLive();
    renderFinishRegistration();
    showToast(`${name}: ${player.totalDistanceM} m registrert.`);
  }

  function decorate() {
    if (!liveTest || liveTest.status !== 'finish') return;

    for (const row of list.querySelectorAll('.finish-row')) {
      if (row.querySelector('.exact-finish')) continue;
      const markerButton = row.querySelector('[data-final-player]');
      const markerBox = row.querySelector('.marker-buttons');
      if (!markerButton || !markerBox) continue;

      const name = markerButton.dataset.finalPlayer;
      const player = liveTest.participants.find(item => item.name === name);
      if (!player) continue;

      const wrap = document.createElement('div');
      wrap.className = 'exact-finish';
      if (player.status === 'finished' && Number.isFinite(player.finalSegmentM) && !FINAL_MARKERS.includes(player.finalSegmentM)) {
        wrap.classList.add('active');
      }

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '399';
      input.step = '1';
      input.inputMode = 'numeric';
      input.placeholder = 'eksakt';
      input.setAttribute('aria-label', `Eksakt meter etter siste hele runde for ${name}`);
      if (player.status === 'finished' && Number.isFinite(player.finalSegmentM)) input.value = String(player.finalSegmentM);

      const unit = document.createElement('span');
      unit.textContent = 'm';

      const ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = '✓';
      ok.setAttribute('aria-label', `Registrer eksakt sluttposisjon for ${name}`);
      ok.addEventListener('click', () => applyExact(name, input.value));
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyExact(name, input.value);
        }
      });

      wrap.append(input, unit, ok);
      markerBox.appendChild(wrap);
    }
  }

  const observer = new MutationObserver(() => queueMicrotask(decorate));
  observer.observe(list, { childList: true, subtree: true });
  decorate();
}

const precisionExtension = `\n;(${precisionFinishExtension.toString()})();\n`;
const blob = new Blob([source, precisionExtension, '\n//# sourceURL=coopertest-app-precision.js\n'], { type: 'text/javascript' });
const url = URL.createObjectURL(blob);
try {
  await import(url);
} finally {
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
