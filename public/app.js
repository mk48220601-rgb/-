/* 우진이 톡! — 클라이언트 로직 */
'use strict';

const $ = (s) => document.querySelector(s);

const AVATARS = ['🦁','🐶','🐱','🐰','🐻','🐨','🦊','🐼','🐯','🦁','🐸','🐵','🐧','🦄','🐮','🐷','🐹'];
const PHRASES = ['안녕! 👋','보고 싶어! 🥰','잘 자 🌙','고마워! 💛','미안해 🙏','사랑해 ❤️','맛있게 먹어 🍙','최고야! ⭐','이 국기 맞혀봐! 🚩','끝말잇기 하자! 🎮','수학 문제 낼게! 🔢','한 나라 골라봐! 🌏'];
const EMOJIS = ['😂','😍','🥰','😊','🤗','🤔','😭','🥺','😴','🤤','👍','👏','🙏','💪','❤️','✨','🎉','🍬','🧸','🌈','🌟','🍀'];
const STAMPS = ['❤️','👍','😂','🎉','🍬','😍','👏','🥰'];
const PLAY = [
  { label: '끝말잇기 🎮', kind: 'wordchain' },
  { label: '말장난 😆', kind: 'pun' },
  { label: '나라·국기 🌏', kind: 'country' },
  { label: '수학 문제 🔢', kind: 'math' },
  { label: '라이언 인사 🦁', kind: 'hello' },
];

const state = {
  me: null,
  users: new Map(),
  messages: [],
  ws: null,
  retry: 1000,
  kicked: false,
  soundOn: true,
  ttsOn: false,
  parent: false,
  demo: location.search.includes('demo'),
  lastDay: null,
  typing: new Map(),
  typingTimer: null,
  lastTypingSent: 0,
  audio: null,
  titleOrig: document.title,
};

const el = {
  join: $('#join'), chat: $('#chat'), msgs: $('#msgs'),
  typingRow: $('#typingRow'), presence: $('#presence'),
  nameInput: $('#nameInput'), avatarGrid: $('#avatarGrid'), enterBtn: $('#enterBtn'),
  soundBtn: $('#soundBtn'), readBtn: $('#readBtn'), parentBtn: $('#parentBtn'),
  input: $('#input'), sendBtn: $('#sendBtn'),
  tabPhrase: $('#tabPhrase'), tabEmoji: $('#tabEmoji'), tabPlay: $('#tabPlay'),
  qkRowF: $('#qkRowF'), qkRowE: $('#qkRowE'), qkRowP: $('#qkRowP'),
  overlay: $('#overlay'),
  pinView: $('#pinView'), panelView: $('#panelView'),
  pinInput: $('#pinInput'), pinOk: $('#pinOk'), pinClose: $('#pinClose'), pinErr: $('#pinErr'),
  tabFamily: $('#tabFamily'), tabWords: $('#tabWords'), tabLog: $('#tabLog'),
  famList: $('#famList'), wordList: $('#wordList'), logView: $('#logView'),
  wordInput: $('#wordInput'), wordAdd: $('#wordAdd'), wordChips: $('#wordChips'),
  logList: $('#logList'), exportBtn: $('#exportBtn'), parentClose: $('#parentClose'),
  popover: $('#popover'), toast: $('#toast'),
};

/* ───────── 유틸 ───────── */
function toast(text, ms = 2600) {
  el.toast.textContent = text;
  el.toast.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.add('hidden'), ms);
}
function hhmm(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return '오늘';
  if (d.toDateString() === y.toDateString()) return '어제';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

/* ───────── 소리 / 읽어주기 ───────── */
function ensureAudio() {
  if (state.audio) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    state.audio = new AC();
  } catch { /* 지원 안 함 */ }
}
function pop() {
  if (!state.soundOn || !state.audio) return;
  try {
    const t0 = state.audio.currentTime;
    const o = state.audio.createOscillator(), g = state.audio.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, t0);
    o.frequency.exponentialRampToValueAtTime(980, t0 + 0.09);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o.connect(g); g.connect(state.audio.destination);
    o.start(t0); o.stop(t0 + 0.24);
  } catch { /* 무시 */ }
}
let _koVoice = null;
function speak(text) {
  if (!('speechSynthesis' in window)) { toast('이 기기에서는 읽어주기를 지원하지 않아요.'); return; }
  speechSynthesis.cancel();
  if (!_koVoice) {
    const v = speechSynthesis.getVoices();
    _koVoice = v.find(x => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith('ko')) || null;
  }
  const u = new SpeechSynthesisUtterance(text);
  if (_koVoice) u.voice = _koVoice;
  u.lang = 'ko-KR'; u.rate = 0.95; u.pitch = 1.1;
  speechSynthesis.speak(u);
}

/* ───────── 접속 ───────── */
function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}
function connect() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;
  const ws = new WebSocket(wsUrl());
  state.ws = ws;
  ws.onopen = () => {
    state.retry = 1000;
    ws.send(JSON.stringify({
      t: 'hello',
      name: el.nameInput.value.trim() || '친구',
      avatar: state.avatar || '🦁',
    }));
    if (!state.kicked) { el.join.classList.add('hidden'); el.chat.classList.remove('hidden'); el.input.focus(); }
  };
  ws.onmessage = (ev) => { let d; try { d = JSON.parse(ev.data); } catch { return; } onMsg(d); };
  ws.onclose = () => {
    state.ws = null;
    if (state.me && !state.kicked) {
      toast('연결이 끊어졌어요. 다시 이어볼게요…', 3000);
      setTimeout(connect, state.retry);
      state.retry = Math.min(state.retry * 2, 8000);
    }
  };
  ws.onerror = () => {};
}

/* ───────── 서버 메시지 처리 ───────── */
function onMsg(d) {
  switch (d.t) {
    case 'welcome': {
      state.me = d.you;
      state.users = new Map(d.users.map(u => [u.id, u]));
      state.messages = [];
      state.lastDay = null;
      el.msgs.innerHTML = '';
      (d.history || []).forEach(m => addMsg(m, { silent: true }));
      renderPresence();
      if (state.demo) runDemo();
      if (!state.kicked) { el.join.classList.add('hidden'); el.chat.classList.remove('hidden'); el.input.focus(); }
      break;
    }
    case 'joined': state.users.set(d.u.id, d.u); renderPresence(); break;
    case 'left': state.users.delete(d.id); state.typing.delete(d.id); renderPresence(); break;
    case 'users': state.users = new Map(d.users.map(u => [u.id, u])); renderPresence(); break;
    case 'msg': addMsg(d.m); break;
    case 'sys': {
      const row = document.createElement('div');
      row.className = 'day-divider';
      row.innerHTML = `<span class="day-chip">🎵 ${esc(d.text)}</span>`;
      el.msgs.appendChild(row);
      scrollIfNear();
      break;
    }
    case 'typing': {
      if (d.s) {
        state.typing.set(d.id, { name: d.name, color: d.color, ts: Date.now() });
        renderTyping();
      } else {
        state.typing.delete(d.id); renderTyping();
      }
      break;
    }
    case 'react': {
      const m = state.messages.find(x => x.id === d.id);
      if (!m) return;
      m.reactions = m.reactions || {};
      const cur = m.reactions[d.e] || { count: 0, mine: false };
      cur.count = d.count;
      if (d.by === state.me.id) cur.mine = d.on;
      m.reactions[d.e] = cur;
      const body = el.msgs.querySelector(`[data-id="${d.id}"] .body`);
      if (body) renderStamps(m, body);
      break;
    }
    case 'notice': toast(d.text); break;
    case 'parent_ok': {
      state.parent = true;
      el.pinView.classList.add('hidden');
      el.panelView.classList.remove('hidden');
      buildFamily();
      buildWords(d.blocked);
      buildLog(d.mod);
      toast('지킴이 공간이 열렸어요. 🛡️');
      break;
    }
    case 'parent_no': {
      el.pinErr.classList.remove('hidden');
      el.pinInput.value = '';
      el.pinInput.focus();
      break;
    }
    case 'blocked_update':
      if (!el.panelView.classList.contains('hidden')) buildWords(d.blocked);
      break;
    case 'mod_update': {
      if (!el.logView.classList.contains('hidden')) insertLog(d.item);
      const li = document.createElement('div');
      li.className = 'day-divider';
      li.innerHTML = `<span class="day-chip">🍬 안전한 말을 써주세요</span>`;
      el.msgs.appendChild(li);
      scrollIfNear();
      break;
    }
    case 'kicked': {
      state.kicked = true;
      state.me = null;
      el.overlay.classList.add('hidden');
      toast('지킴이님이 잠시 쉬어 가라고 하셨어요. 🛡️');
      setTimeout(() => { try { state.ws && state.ws.close(); } catch {} }, 300);
      el.chat.classList.add('hidden');
      el.join.classList.remove('hidden');
      break;
    }
    case 'muted':
      toast(d.on ? '지금은 이야기를 잠시 쉬어요. 지킴이가 알려줄게요. 🌙' : '이야기할 수 있어요! 😊');
      break;
  }
}

/* ───────── 메시지 렌더링 ───────── */
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function addMsg(m, opts = {}) {
  if (!m || typeof m.id !== 'string') return;
  if (state.messages.some(x => x.id === m.id)) return;
  m.reactions = m.reactions || {};
  state.messages.push(m);
  renderMsg(m);
  const mine = m.from === (state.me && state.me.id);
  if (!opts.silent && !mine) {
    if (state.soundOn) pop();
    if (state.ttsOn && !m.lion) speak(m.text);
    if (document.hidden) document.title = '💬 ' + state.titleOrig;
  }
  scrollIfNear(mine);
}
function scrollIfNear(force) {
  const c = el.msgs;
  if (force || c.scrollTop + c.clientHeight >= c.scrollHeight - 90) {
    requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; });
  }
}
function renderMsg(m) {
  const mine = m.from === (state.me && state.me.id);
  const day = dayLabel(m.ts);
  if (state.lastDay !== day) {
    state.lastDay = day;
    const dv = document.createElement('div');
    dv.className = 'day-divider';
    dv.innerHTML = `<span class="day-chip">${day}</span>`;
    el.msgs.appendChild(dv);
  }

  const row = document.createElement('div');
  row.className = 'msg' + (mine ? ' mine' : '') + (m.lion ? ' lion' : '');
  row.dataset.id = m.id;

  const av = document.createElement('div');
  av.className = 'avatar';
  av.textContent = m.avatar || '🦁';
  row.appendChild(av);

  const body = document.createElement('div');
  body.className = 'body';

  const who = document.createElement('div');
  who.className = 'who';
  who.style.color = m.color || '#43BE9A';
  who.textContent = m.lion ? '라이언' : (mine ? '나' : (m.name || '친구'));
  body.appendChild(who);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.style.setProperty('--c', m.color || '#43BE9A');
  bubble.textContent = m.text;
  body.appendChild(bubble);

  const tools = document.createElement('div');
  tools.className = 'tools';
  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'tool'; ttsBtn.textContent = '🔊'; ttsBtn.title = '소리 내어 읽기';
  ttsBtn.addEventListener('click', (e) => { e.stopPropagation(); speak(m.text); });
  const stBtn = document.createElement('button');
  stBtn.className = 'tool'; stBtn.textContent = '😊'; stBtn.title = '스탬프 찍기';
  stBtn.addEventListener('click', (e) => { e.stopPropagation(); openPopover(row, m); });
  tools.appendChild(ttsBtn); tools.appendChild(stBtn);
  body.appendChild(tools);

  const st = document.createElement('div');
  st.className = 'stamps';
  renderStamps(m, body);
  body.appendChild(st);

  const when = document.createElement('div');
  when.className = 'when';
  when.textContent = hhmm(m.ts);
  body.appendChild(when);

  row.appendChild(body);
  el.msgs.appendChild(row);
}

function renderStamps(m, bodyEl) {
  const cont = bodyEl.querySelector('.stamps');
  if (!cont) return;
  cont.innerHTML = '';
  const entries = Object.entries(m.reactions || {}).filter(([, v]) => v && v.count > 0);
  for (const [e, v] of entries) {
    const chip = document.createElement('button');
    chip.className = 'stamp-chip' + (v.mine ? ' hot' : '');
    chip.textContent = e;
    const cnt = document.createElement('span');
    cnt.className = 'cnt'; cnt.textContent = v.count;
    chip.appendChild(cnt);
    chip.addEventListener('click', () => sendReact(m, e, !v.mine));
    cont.appendChild(chip);
  }
}
function sendReact(m, e, on) {
  sendWs({ t: 'react', id: m.id, e, on });
  const cur = m.reactions[e] || { count: 0, mine: false };
  cur.mine = on;
  cur.count = Math.max(0, cur.count + (on ? 1 : -1));
  if (cur.count === 0) delete m.reactions[e];
  else m.reactions[e] = cur;
  const body = el.msgs.querySelector(`[data-id="${m.id}"] .body`);
  if (body) renderStamps(m, body);
}

/* ───────── 스탬프 팝오버 ───────── */
function openPopover(row, m) {
  el.popover.innerHTML = '';
  for (const e of STAMPS) {
    const b = document.createElement('button');
    b.textContent = e;
    b.addEventListener('click', () => {
      const cur = m.reactions[e];
      sendReact(m, e, !(cur && cur.mine));
      closePopover();
    });
    el.popover.appendChild(b);
  }
  el.popover.classList.remove('hidden');
}
function closePopover() {
  el.popover.classList.add('hidden');
  el.popover.innerHTML = '';
}
document.addEventListener('pointerdown', (e) => {
  if (!el.popover.classList.contains('hidden') && !el.popover.contains(e.target)) closePopover();
  ensureAudio();
});

/* ───────── 타이핑 표시 ───────── */
function renderTyping() {
  clearTimeout(state.typingTimer);
  const now = Date.now();
  for (const [id, v] of state.typing) if (now - v.ts > 2600) state.typing.delete(id);
  if (state.typing.size === 0) { el.typingRow.classList.add('hidden'); return; }
  const names = [...state.typing.values()].map(v => `<b style="color:${v.color}">${esc(v.name)}</b>`).join(', ');
  el.typingRow.innerHTML = `
    <span class="t-av">🦁</span>
    <span class="t-bubble"><span class="t-dots"><i></i><i></i><i></i></span> ${names} 님도 두들두들 쓰는 중…</span>`;
  el.typingRow.classList.remove('hidden');
  state.typingTimer = setTimeout(renderTyping, 800);
}
function sendTyping(on) {
  const now = Date.now();
  if (on && now - state.lastTypingSent < 600) return;
  state.lastTypingSent = now;
  sendWs({ t: 'typing', s: on });
}

/* ───────── 보내기 ───────── */
function sendWs(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
}
function send() {
  const text = el.input.value.trim();
  if (!text) return;
  sendWs({ t: 'msg', text });
  el.input.value = '';
  sendTyping(false);
}

/* ───────── 상단 표시 ───────── */
function renderPresence() {
  const list = [...state.users.values()];
  const mutedCount = list.filter(u => u.muted).length;
  let html = '<span class="p-num">' + list.length + '명이 함께해요';
  if (mutedCount > 0) html += ' · ' + mutedCount + '명 쉬는 중';
  html += '</span>';
  const avs = list.slice(0, 10).map(u => `<span class="p-av" title="${esc(u.name)}">${u.avatar}</span>`).join('');
  el.presence.innerHTML = avs + html;
}

/* ───────── 퀵바 ───────── */
function setTab(onBtn, rows) {
  [el.tabPhrase, el.tabEmoji, el.tabPlay].forEach(b => b.classList.remove('on'));
  onBtn.classList.add('on');
  [el.qkRowF, el.qkRowE, el.qkRowP].forEach(r => r.classList.add('hidden'));
  for (const r of rows) r.classList.remove('hidden');
}
function fillQuick() {
  for (const p of PHRASES) {
    const c = document.createElement('button');
    c.className = 'chip'; c.textContent = p;
    c.addEventListener('click', () => { el.input.value = p; send(); });
    el.qkRowF.appendChild(c);
  }
  for (const e of EMOJIS) {
    const c = document.createElement('button');
    c.className = 'chip'; c.textContent = e; c.style.fontSize = '20px';
    c.addEventListener('click', () => { el.input.value = e; send(); });
    el.qkRowE.appendChild(c);
  }
  for (const p of PLAY) {
    const c = document.createElement('button');
    c.className = 'chip play-chip'; c.textContent = p.label;
    c.addEventListener('click', () => sendWs({ t: 'lion', kind: p.kind }));
    el.qkRowP.appendChild(c);
  }
  el.tabPhrase.addEventListener('click', () => setTab(el.tabPhrase, [el.qkRowF]));
  el.tabEmoji.addEventListener('click', () => setTab(el.tabEmoji, [el.qkRowE]));
  el.tabPlay.addEventListener('click', () => setTab(el.tabPlay, [el.qkRowP]));
}

/* ───────── 입장 화면 ───────── */
function initJoin() {
  state.avatar = localStorage.getItem('tobak_avatar') || '🦁';
  el.nameInput.value = localStorage.getItem('tobak_name') || '우진';
  for (const a of [...new Set(AVATARS)]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'avatar-btn' + (a === state.avatar ? ' on' : '');
    b.textContent = a;
    b.addEventListener('click', () => {
      document.querySelectorAll('.avatar-btn').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      state.avatar = a;
      localStorage.setItem('tobak_avatar', a);
    });
    el.avatarGrid.appendChild(b);
  }
  el.enterBtn.addEventListener('click', () => {
    const name = el.nameInput.value.trim();
    if (!name) {
      el.nameInput.classList.remove('shake');
      void el.nameInput.offsetWidth;
      el.nameInput.classList.add('shake');
      el.nameInput.focus();
      toast('이름을 먼저 또박또박 적어주세요 ✏️');
      return;
    }
    localStorage.setItem('tobak_name', name);
    state.kicked = false;
    connect();
  });
  el.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.enterBtn.click(); });
}

/* ───────── 데모 모드(?demo=1) ───────── */
function runDemo() {
  setTimeout(() => {
    const mk = (id, name, avatar, color, text, ts, lion) => ({
      id, from: id, name, avatar, color, text, ts, lion: !!lion, reactions: {}, muted: false,
    });
    state.users.set('demo-a', { id: 'demo-a', name: '엄마', avatar: '🐰', color: '#FF8E53', muted: false });
    state.users.set('demo-b', { id: 'demo-b', name: '아빠', avatar: '🦉', color: '#7C9BF0', muted: false });
    renderPresence();
    const n = Date.now();
    const m1 = mk('demo-a', '엄마', '🐰', '#FF8E53', '우진아! 오늘 학교에서 뭐 했어? 😊', n - 200000);
    addMsg(m1, { silent: true });
    state.typing.set('demo-b', { name: '아빠', color: '#7C9BF0', ts: Date.now() });
    renderTyping();
    setTimeout(() => {
      state.typing.delete('demo-b');
      renderTyping();
      addMsg(mk('demo-b', '아빠', '🦉', '#7C9BF0', '끝말잇기 하자! 첫말은 ‘사자’! 🦁', n - 110000));
      setTimeout(() => {
        m1.reactions['❤️'] = { count: 2, mine: true };
        const row = el.msgs.querySelector(`[data-id="${m1.id}"] .body`);
        if (row) renderStamps(m1, row);
        addMsg(mk('demo-lion1', '라이언', '🦁', '#E09A00', '말장난 하나! 수학책이 울 때 하는 말 → “내 문제가 많아서 그래!” 😂', n - 60000, true));
        setTimeout(() => {
          addMsg(mk('demo-lion2', '라이언', '🦁', '#E09A00', '오늘의 나라 🇫🇷 프랑스! 수도는 파리! 에펠탑이 유명해!', n - 30000, true));
        }, 2400);
      }, 2200);
    }, 2000);
  }, 900);
}

/* ───────── 부모 모드 ───────── */
function openParent() {
  el.overlay.classList.remove('hidden');
  el.pinView.classList.remove('hidden');
  el.panelView.classList.add('hidden');
  el.pinInput.value = '';
  el.pinErr.classList.add('hidden');
  setTimeout(() => el.pinInput.focus(), 80);
}
function closeParent() { el.overlay.classList.add('hidden'); el.pinErr.classList.add('hidden'); }
function buildFamily() {
  el.famList.innerHTML = '';
  const list = [...state.users.values()];
  if (list.length === 0) { el.famList.innerHTML = `<p class="log-desc">아직 아무도 없어요.</p>`; return; }
  for (const u of list) {
    const isMe = u.id === state.me.id;
    const row = document.createElement('div');
    row.className = 'member-row';
    const av = document.createElement('span');
    av.className = 'm-av'; av.textContent = u.avatar;
    row.appendChild(av);
    const name = document.createElement('div');
    name.className = 'm-name';
    name.innerHTML = `${esc(u.name)} ${isMe ? '<small class="m-me">나</small>' : ''}`;
    row.appendChild(name);
    if (!isMe) {
      const mute = document.createElement('button');
      mute.className = 'mini-btn' + (u.muted ? ' on' : '');
      mute.textContent = u.muted ? '말 하기' : '조용히';
      mute.addEventListener('click', () => sendWs({ t: 'parent_mute', id: u.id, on: !u.muted }));
      row.appendChild(mute);
      const kick = document.createElement('button');
      kick.className = 'mini-btn danger';
      kick.textContent = '나가 해';
      kick.addEventListener('click', () => { if (confirm(u.name + '님을 대화방에서 나가 드릴까요?')) sendWs({ t: 'parent_kick', id: u.id }); });
      row.appendChild(kick);
    }
    el.famList.appendChild(row);
  }
}
function buildWords(list) {
  el.wordChips.innerHTML = '';
  for (const w of list || []) {
    const chip = document.createElement('span');
    chip.className = 'word-chip';
    const txt = document.createElement('span'); txt.textContent = w;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', () => sendWs({ t: 'parent_block', word: w, add: false }));
    chip.appendChild(txt); chip.appendChild(del);
    el.wordChips.appendChild(chip);
  }
}
function buildLog(mods) {
  el.logList.innerHTML = '';
  (mods || []).slice().reverse().forEach(insertLog);
}
function insertLog(item) {
  const d = document.createElement('div');
  d.className = 'log-item';
  const meta = document.createElement('div');
  meta.className = 'l-meta';
  meta.textContent = `${hhmm(item.ts)} · ${item.name}님`;
  const body = document.createElement('div');
  body.textContent = item.text;
  d.appendChild(meta); d.appendChild(body);
  el.logList.insertBefore(d, el.logList.firstChild);
}
function exportLog() {
  const lines = [];
  let lastDay = null;
  for (const m of state.messages) {
    const day = dayLabel(m.ts);
    if (day !== lastDay) { lines.push('── ' + day + ' ──'); lastDay = day; }
    const who = m.lion ? '라이언' : (m.from === state.me.id ? '나' : m.name);
    lines.push(`[${hhmm(m.ts)}] ${who}: ${m.text}`);
  }
  lines.unshift('우진이 톡! 대화 기록 🍬');
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `우진이톡_대화기록_${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('대화 기록을 내보냈어요. 📄');
}

/* ───────── 이벤트 연결 ───────── */
function bindEvents() {
  el.sendBtn.addEventListener('click', send);
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  el.input.addEventListener('input', () => sendTyping(true));
  el.input.addEventListener('blur', () => sendTyping(false));

  el.soundBtn.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    el.soundBtn.textContent = state.soundOn ? '🔊' : '🔇';
    el.soundBtn.classList.toggle('off', !state.soundOn);
  });
  el.readBtn.addEventListener('click', () => {
    state.ttsOn = !state.ttsOn;
    el.readBtn.textContent = state.ttsOn ? '📖' : '📕';
    el.readBtn.classList.toggle('off', !state.ttsOn);
    toast(state.ttsOn ? '새 메시지를 소리 내어 읽어줄게요 🔊' : '읽어주기를 끌게요');
  });

  el.parentBtn.addEventListener('click', openParent);
  el.pinClose.addEventListener('click', closeParent);
  el.parentClose.addEventListener('click', closeParent);
  el.overlay.addEventListener('pointerdown', (e) => { if (e.target === el.overlay) closeParent(); });
  el.pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.pinOk.click(); });
  el.pinOk.addEventListener('click', () => {
    const pin = el.pinInput.value.trim();
    if (!pin || pin.length < 4) { toast('비밀번호 4자리를 눌러주세요.'); return; }
    sendWs({ t: 'parent_enter', pin });
  });

  el.tabFamily.addEventListener('click', () => setPanelTab(el.tabFamily, el.famList));
  el.tabWords.addEventListener('click', () => setPanelTab(el.tabWords, el.wordList));
  el.tabLog.addEventListener('click', () => setPanelTab(el.tabLog, el.logView));
  el.wordAdd.addEventListener('click', () => {
    const w = el.wordInput.value.trim();
    if (!w) return;
    sendWs({ t: 'parent_block', word: w, add: true });
    el.wordInput.value = '';
  });
  el.wordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.wordAdd.click(); });
  el.exportBtn.addEventListener('click', exportLog);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) document.title = state.titleOrig;
  });
  window.addEventListener('beforeunload', () => { if (state.ws) sendTyping(false); });
}
function setPanelTab(tabBtn, bodyEl) {
  document.querySelectorAll('.panel-tabs .qk-tab').forEach(x => x.classList.remove('on'));
  tabBtn.classList.add('on');
  for (const b of [el.famList, el.wordList, el.logView]) b.classList.add('hidden');
  bodyEl.classList.remove('hidden');
}

/* ───────── 시작 ───────── */
initJoin();
fillQuick();
bindEvents();
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { _koVoice = null; };
}
