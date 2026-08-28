/**
 * 또박톡 (TobakTok)
 * 아이를 위한 가족 채팅 — 모바일 웹 + WebSocket 실시간 메시지
 *
 * 실행:  npm install  →  npm start   (기본 :3000)
 * 환경변수:
 *   PORT          서버 포트 (기본 3000)
 *   PARENT_PIN    부모 모드 비밀번호 (기본 0000 — 꼭 바꾸세요)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PARENT_PIN = process.env.PARENT_PIN || '0000';
const MAX_HISTORY = 100;      // 새로 들어온 사람에게 보내줄 메시지 수
const MAX_TEXT = 300;         // 메시지 최대 글자 수
const RATE_N = 14;            // 10초 동안 허용하는 메시지 수 (도배 방지)
const RATE_WIN = 10_000;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PALETTE = [
  '#FF7AA2', '#4FB6EC', '#57C7A2', '#9B8AFB', '#FFC94D',
  '#FF8E53', '#E86FA6', '#54C8C8', '#F5A742', '#7C9BF0',
];

// ---------- 상태 ----------
const users = new Map();     // ws -> 프로필
const messages = [];         // 메시지 기록 {id, from, name, avatar, color, text, ts, muted}
const modLog = [];           // 안전 단어에 걸린 메시지 기록
const lastTyping = new Map();// 유저별 마지막 타이핑 브로드캐스트 시각

// 기본 안전 단어 목록 (부모 모드에서 자유롭게 추가/삭제 가능)
let blocked = ['씨발','시발','ㅅㅂ','병신','ㅂㅅ','존나','지랄','미친','닥쳐','느금마','ㅁㅊ','개새끼','좆까'];

// 라이언(리오)이 우진이에게 들려주는 말자료
const LION = {
  pun: [
    '수학책이 울 때 하는 말? → “내 문제가 많아서 그래!” 😂',
    '겨울에 제일 바쁜 사람? → 눈사람! 자꾸 ‘쌓여서’ 바빠! ⛄',
    '지우개가 화내는 이유? → 자꾸 ‘지워’지니까! 😤',
    '제일 차가운 강? → 한강! ‘한’겨울에만 보여! 🥶',
    '바나나가 웃으면? → ‘껌껄껄’! 껍질이 들려서! 🍌',
    '개가 배가 아픈 병? → ‘개’복통! 🐶',
    '소가 컴퓨터를 못 하는 이유? → ‘소’프트웨어가 없어서! 🐮',
    '새가 노래할 때 쓰는 말? → ‘짹’! 그리고 ‘짹짹’! 🐦',
  ],
  country: [
    '오늘의 나라 🇰🇷 대한민국! 수도는 서울! 태극기를 흔들어 보자!',
    '오늘의 나라 🇫🇷 프랑스! 수도는 파리! 에펠탑이 유명해!',
    '오늘의 나라 🇺🇸 미국! 수도는 워싱턴 D.C.! 국기에 별이 50개야!',
    '오늘의 나라 🇧🇷 브라질! 수도는 브라질리아! 축구를 제일 좋아하는 나라야!',
    '오늘의 나라 🇦🇺 호주! 수도는 캔버라! 캥거루가 뛰어다녀!',
    '오늘의 나라 🇨🇭 스위스! 수도는 베른! 초콜릿이 유명해!',
    '오늘의 나라 🇪🇬 이집트! 수도는 카이로! 피라미드가 있어!',
    '오늘의 나라 🇯🇵 일본! 수도는 도쿄! 후지산이 멋져!',
  ],
  math: [
    '우진아! 7 + 8 = ? 정답은 15! 수학 천재면 바로 알았겠지? 🔢',
    '우진아! 9 + 9 = ? 쿠키 9개에 9개 더하면 18! 🍪',
    '우진아! 25 - 7 = ? 얼른 또박또박 계산해봐! 정답 18!',
    '우진아! 3 × 4 = ? 정답 12! 봄에 피는 꽃 12송이! 🌷',
    '우진아! 6 × 7 = ? 정답 42! 모든 것의 답이래! 😄',
    '우진아! 12 + 13 = ? 정답 25! 생일 숫자 같지 않아? 🎂',
    '우진아! 50 ÷ 2 = ? 절반은 25! 반푼이 하지 말자! 😆',
    '우진아! 8 × 8 = ? 정답 64! 천천히 해도 된단다! 힘내! 💪',
  ],
  wordchain: [
    '끝말잇기 시작! 첫말은 ‘사자’! 이제 ‘자’로 시작하는 말을 또박또박 써봐! 🦁',
    '끝말잇기 다음! ‘자동차’ → ‘차’로 시작하는 말! 어디 한번! 🚗',
    '끝말잇기 빠르게! ‘사탕’ → ‘탕’으로 시작하는 말! 달콤하게 이어가자! 🍬',
  ],
  hello: [
    '우진아! 🦁 오늘도 만나서 반가워! 오늘 기분은 어때?',
    '우진아! 오늘 뭐 하고 놀까? 끝말잇기? 수학? 아니면 나라 퀴즈? 🦁',
    '라이언이 우진이를 기다리고 있었어! 🧡 오늘도 즐겁게 놀자!',
  ],
};
const LION_WELCOME = [
  '우진이 왔다!! 🦁🦁 오늘도 같이 놀자!',
  '우진이 입장! 라이언이 반가워서 꼬리를 흔들어! 🧡',
  '우진이야? 우리 대화방의 주인공이 왔구나! 🦁',
];
const OTHERS_WELCOME = [
  '엄마한테(에게) 인사! 우리 함께 우진이랑 놀아요 🧡',
  '새 친구가 또박또박 들어왔어요. 잘 부탁해요!',
];

// ============================================================
// 라이언 대화 봇 — 우진이가 컴퓨터(라이언)와 실시간으로 놀이 대화
// 규칙 기반이라 외부 AI API가 필요 없고, 아이에게 안전한 문장만 써요.
// ============================================================
const BOT_WORDBANK = [
  '가방','가게','가족','가수','강아지','고양이','고래','고구마','고무줄',
  '나비','나라','나무','나이','노래','노트','노란색','눈사람',
  '다리','다음','다람쥐','도넛','도시','도깨비','도마뱀','동물',
  '라면','라디오','라이언','라켓','로봇','로켓','레몬',
  '마법','마을','마늘','모자','모래','모나리자','멋쟁이',
  '바다','바나나','바람','보물','보라색','보트','배','병아리',
  '사자','사과','사탕','사다리','소','소방차','소나무','새','세상','수박',
  '아이','아침','아기','아파트','아빠','우산','우주','유리','요리','요정','예쁜',
  '자동차','자전거','자석','장난감','지구','지우개','잠자리',
  '차','차표','초콜릿','친구','천사','축구',
  '카드','카메라','카레','카페','코끼리','코알라','쿠키','콩나물',
  '타조','토마토','토끼','토요일','티라노사우루스','탁구',
  '파도','파란색','파이','파티','포도','포크','풍선','피아노','피자',
  '하늘','하마','하나','하트','호랑이','호수','호박','해','해바라기','햄버거','한국','한강','한복',
];
const BOT_FLAGS = [
  { n: '대한민국', f: '🇰🇷', c: '서울', x: '태극기에는 4가지 모양이 있어!' },
  { n: '프랑스', f: '🇫🇷', c: '파리', x: '에펠탑이 유명해!' },
  { n: '미국', f: '🇺🇸', c: '워싱턴 D.C.', x: '국기에 별이 50개야!' },
  { n: '브라질', f: '🇧🇷', c: '브라질리아', x: '축구를 아주 좋아해!' },
  { n: '호주', f: '🇦🇺', c: '캔버라', x: '캥거루가 뛰어다녀!' },
  { n: '스위스', f: '🇨🇭', c: '베른', x: '초콜릿으로 유명해!' },
  { n: '이집트', f: '🇪🇬', c: '카이로', x: '피라미드가 있어!' },
  { n: '일본', f: '🇯🇵', c: '도쿄', x: '후지산이 멋져!' },
  { n: '중국', f: '🇨🇳', c: '베이징', x: '만리장성이 있어!' },
  { n: '영국', f: '🇬🇧', c: '런던', x: '빅벤이 유명해!' },
];
const botState = new Map();   // 사용자 id -> { math?, flag?, chain? }

function lastChar(w) { return w[w.length - 1]; }
function firstChar(w) { return w[0]; }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function wordFor(startSyllable) {
  const pool = BOT_WORDBANK.filter(w => firstChar(w) === startSyllable);
  return pool.length ? randPick(pool) : null;
}
function lionSay(text) {
  const m = {
    id: uid(), from: 'lion', name: '라이언', avatar: '🦁', color: '#E09A00',
    text, ts: Date.now(), lion: true, muted: false,
  };
  messages.push(m);
  if (messages.length > 400) messages.shift();
  broadcast({ t: 'msg', m });
}
function mathProblem() {
  const ops = ['+', '+', '-', '×'];
  const op = randPick(ops);
  let a = 2 + Math.floor(Math.random() * 16);
  let b = 2 + Math.floor(Math.random() * 14);
  if (op === '-') { if (b > a) { const t2 = a; a = b; b = t2; } }
  let ans;
  if (op === '+') ans = a + b;
  else if (op === '-') ans = a - b;
  else ans = a * b;
  return { q: `${a} ${op} ${b}`, ans };
}
function botMenu(p) {
  lionSay(`${p.name}아! 라이언이랑 뭐 하고 놀까? 🦁\n① 끝말잇기 ② 수학 문제 ③ 국기 퀴즈 ④ 말장난 ⑤ 나라 상식\n그냥 “끝말잇기!”라고 말하면 바로 시작해!`);
}
function maybeBot(ws, p, rawText) {
  const t = rawText.replace(/\s+/g, ' ').trim();
  if (!t) return;
  const st = botState.get(p.id) || (botState.set(p.id, {}), botState.get(p.id));
  const mentions = t.includes('라이언');
  const num = t.replace(/,/g, '').trim();
  const isNum = /^\d+$/.test(num);
  const isCommandMsg = /끝말잇기|수학|문제|국기|퀴즈|나라|말장난|농담|안녕|심심|힘들|아파|슬퍼|졸려|고마워|사랑해|최고|놀자|뭐 하|같이/.test(t);
  if (isCommandMsg) { st.flag = undefined; st.math = undefined; }

  // 1) 끝말잇기 진행 중 (단어 심판)
  if (st.chain) {
    const need = st.chain.need;
    if (firstChar(t) === need) {
      st.chain.need = lastChar(t);
      const reply = wordFor(lastChar(t));
      if (reply && reply !== t) {
        st.chain.last = reply;
        lionSay(`또박또박 잘했어요! “${t}”! 🎉 그럼 나는 “${reply}”! 이제 ‘${lastChar(reply)}’로 시작하는 말!`);
      } else {
        st.chain = undefined;
        lionSay(`오! “${t}”… 내가 이어갈 단어가 없네! 우진이 승리! 🏆 또 하려면 “끝말잇기!”라고 불러줘!`);
      }
    } else {
      const hint = wordFor(need);
      lionSay(`우진아, 지금은 ‘${need}’로 시작하는 말이야! ${hint ? `예: “${hint}”! ` : ''}다시 생각해봐 😊`);
    }
    return;
  }
  // 2) 수학 문제 대기 중 — 숫자 답 확인
  if (st.math !== undefined) {
    if (isNum) {
      const n = parseInt(num, 10);
      if (n === st.math) {
        st.math = undefined;
        lionSay(`정답!! ${n}! 우진이는 수학 천재! 🔢✨ 또 풀고 싶으면 “수학 문제!”라고 해!`);
      } else {
        lionSay(`음… ${n}? 아니야! 힌트: 정답은 ${st.math < 20 ? '20보다 작은 수야' : st.math < 40 ? '두 자리 수야' : '곱셈이라 40 근처야'}! 다시 한번! 😤`);
      }
      return;
    }
    if (!mentions && !/수학|문제|정답|몇|힌트/.test(t)) return;
  }
  // 3) 국기 퀴즈 대기 중 — 나라 이름을 말한 경우만 채점, 일반 대화는 조용히
  if (st.flag) {
    const guessed = BOT_FLAGS.find(f => t.includes(f.n));
    if (!guessed) return;
    if (guessed.n === st.flag) {
      st.flag = undefined;
      lionSay(`정답!! ${guessed.n} 맞아! ${guessed.f} ${guessed.x} 🌏✨`);
    } else {
      lionSay(`그건 ${guessed.n}! 지금 문제는 ${BOT_FLAGS.find(f => f.n === st.flag)?.f} ${st.flag}였어! 다시 도전! 🔄`);
    }
    return;
  }
  // 4) 계산식 감지 ("7+8=" 같은)
  const m = t.match(/(\d+)\s*([+\-×xX*÷/])\s*(\d+)/);
  if (m && (mentions || st.math === undefined || /수학|문제|답/.test(t))) {
    const a = parseInt(m[1], 10), b = parseInt(m[3], 10);
    const op = m[2];
    let ans;
    if (['+', '더하기', '플러스'].includes(op)) ans = a + b;
    else if (['-', '빼기', '마이너스'].includes(op)) ans = a - b;
    else if (['×', '*', 'x', 'X', '곱하기'].includes(op)) ans = a * b;
    else ans = Math.floor(a / b);
    st.math = undefined;
    lionSay(`${a} ${op} ${b} = ${ans}! 우진이 멋져! 🎉`);
    return;
  }
  // 5) 지시어 처리
  if (/끝말잇기/.test(t)) {
    const start = wordFor('가') || '사자';
    st.chain = { need: lastChar(start), last: start };
    lionSay(`끝말잇기 시작! “${start}”! 이제 ‘${lastChar(start)}’로 시작하는 말을 또박또박 써봐! 🎮`);
    return;
  }
  if (/수학|문제|정답/.test(t)) {
    const pb = mathProblem();
    st.math = pb.ans;
    lionSay(`우진아, ${pb.q} = ? 🤔`);
    return;
  }
  if (/국기|퀴즈/.test(t)) {
    const f = randPick(BOT_FLAGS);
    st.flag = f.n;
    lionSay(`이 국기(flag)는 어느 나라일까? ${f.f} 🤔`);
    return;
  }
  if (/나라/.test(t)) {
    const f = randPick(BOT_FLAGS);
    lionSay(`오늘의 나라 ${f.f} ${f.n}! 수도는 ${f.c}야. ${f.x}`);
    return;
  }
  if (/말장난|농담/.test(t)) {
    lionSay(randPick(LION.pun));
    return;
  }
  if (/안녕|하이|반가/.test(t) && t.length <= 16) {
    lionSay(`${p.name}아, 안녕! 🦁 오늘도 반가워! ${randPick(['끝말잇기 하자?', '수학 문제 풀어볼래?', '국기 퀴즈 한 판?', '내가 말장난 하나 해줄까? 😆'])}`);
    return;
  }
  if (/심심/.test(t)) {
    const start = wordFor('가') || '사자';
    st.chain = { need: lastChar(start), last: start };
    lionSay(`심심해? 그럼 나랑 끝말잇기! “${start}”! 이제 ‘${lastChar(start)}’로 시작하는 말! 🎮`);
    return;
  }
  if (/힘들|아파|슬퍼|졸려/.test(t)) {
    lionSay(`${p.name}아, 괜찮아? 🧡 우진이는 최고의 친구야! 천천히 쉬어도 돼. 나는 옆에 있을게!`);
    return;
  }
  if (/고마워|사랑해|최고/.test(t)) {
    lionSay(`나도 ${p.name}이(가) 제일 좋아! 🧡🦁 너는 우리 가족의 자랑이야!`);
    return;
  }
  if (/놀자|뭐 하|같이/.test(t) || mentions) {
    botMenu(p);
  }
}

// ---------- 유틸 ----------
function uid() { return crypto.randomBytes(6).toString('hex'); }
function norm(s) { return String(s).replace(/\s/g, '').toLowerCase(); }
function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function findBad(text) {
  const t = norm(text);
  for (const w of blocked) {
    const nw = norm(w);
    if (nw && t.includes(nw)) return w;
  }
  return null;
}
// 걸린 단어를 사탕 🍬으로 바꾼다
function censor(text) {
  let t = String(text);
  const done = new Set();
  for (let i = 0; i < 6; i++) {
    const w = findBad(t);
    if (!w || done.has(norm(w))) break;
    done.add(norm(w));
    t = t.replace(new RegExp(escapeReg(w), 'gi'), '🍬');
  }
  return t;
}
function colorFor(seed) {
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj, except = null) {
  for (const w of users.keys()) if (w !== except) send(w, obj);
}
function snapshot() {
  return Array.from(users.values()).map(({ id, name, avatar, color, muted }) => ({ id, name, avatar, color, muted }));
}
function isParent(ws) { const p = users.get(ws); return !!(p && p.parent); }
function rateOk(ws) {
  const p = users.get(ws);
  if (!p) return false;
  const now = Date.now();
  p.counts = p.counts.filter(t => now - t < RATE_WIN);
  if (p.counts.length >= RATE_N) return false;
  p.counts.push(now);
  return true;
}

// ---------- HTTP: 정적 파일 (public/) ----------
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { urlPath = '/'; }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('또박또박? 그 페이지는 없어요.');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// ---------- WebSocket: 실시간 채팅 ----------
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;

  const route = (raw) => {
    let obj;
    try { obj = JSON.parse(raw); } catch { return; }
    if (!obj || typeof obj.t !== 'string') return;

    // ----- 입장 -----
    if (obj.t === 'hello') {
      if (users.has(ws)) return;
      const name = String(obj.name || '').replace(/\s+/g, ' ').trim().slice(0, 10) || '친구';
      const avatars = ['🐶','🐱','🐰','🐻','🐨','🦊','🐼','🐯','🦁','🐸','🐵','🐧','🦄','🐮','🐷','🐹'];
      const avatar = avatars.includes(obj.avatar) ? obj.avatar : '🐶';
      const profile = {
        id: uid(),
        name, avatar,
        color: colorFor(name + obj.avatar),
        muted: false, parent: false,
        counts: [], kicked: false,
      };
      users.set(ws, profile);
      send(ws, {
        t: 'welcome',
        you: { id: profile.id, name, avatar, color: profile.color },
        users: snapshot(),
        history: messages.slice(-MAX_HISTORY),
        blocked,
      });
      broadcast({ t: 'joined', u: { id: profile.id, name, avatar, color: profile.color } });
      broadcast({ t: 'users', users: snapshot() });
      const helloList = name.includes('우진') ? LION_WELCOME : OTHERS_WELCOME;
      broadcast({ t: 'sys', text: helloList[Math.floor(Math.random() * helloList.length)] });
      return;
    }

    const p = users.get(ws);
    if (!p) {
      if (obj.t === 'parent_enter') { send(ws, { t: 'notice', text: '먼저 대화방에 입장해 주세요.' }); }
      return;
    }

    // ----- 메시지 -----
    if (obj.t === 'msg') {
      if (!rateOk(ws)) { send(ws, { t: 'notice', text: '너무 빠르게 보내고 있어요. 잠시 숨을 고르세요! 🌬️' }); return; }
      let text = String(obj.text || '').replace(/\s+$/g, '').trim();
      if (!text) return;
      if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
      const bad = findBad(text);
      let finalText = text;
      if (bad) {
        finalText = censor(text);
        modLog.push({ ts: Date.now(), name: p.name, text });
        if (modLog.length > 200) modLog.shift();
        broadcast({ t: 'mod_update', item: modLog[modLog.length - 1], word: bad });
      }
      const m = {
        id: uid(), from: p.id, name: p.name, avatar: p.avatar, color: p.color,
        text: finalText, ts: Date.now(), muted: false,
      };
      messages.push(m);
      if (messages.length > 400) messages.shift();
      if (p.muted) {
        // 음소거된 유저의 메시지는 본인 + 부모님에게만 보인다
        const targets = [ws, ...Array.from(users.keys()).filter(w => isParent(w))];
        for (const w of targets) send(w, { t: 'msg', m });
      } else {
        broadcast({ t: 'msg', m });
      }
      maybeBot(ws, p, p.muted ? '' : text);
      return;
    }

    // ----- 타이핑 표시 -----
    if (obj.t === 'typing') {
      const on = !!obj.s;
      const now = Date.now();
      const last = lastTyping.get(p.id) || 0;
      if (on && now - last < 600) return;
      lastTyping.set(p.id, now);
      if (!p.muted) {
        broadcast({ t: 'typing', id: p.id, name: p.name, color: p.color, s: on }, ws);
      }
      return;
    }

    // ----- 메시지 스탬프(반응) -----
    if (obj.t === 'react') {
      const allow = ['❤️', '👍', '😂', '🎉', '🍬', '😍', '👏', '🥰'];
      const e = String(obj.e || '');
      if (!allow.includes(e)) return;
      const m = messages.find(x => x.id === obj.id);
      if (!m) return;
      m.reactions = m.reactions || {};
      const list = m.reactions[e] || [];
      let on = !!obj.on;
      const i = list.indexOf(p.id);
      if (on && i === -1) list.push(p.id);
      if (!on && i !== -1) list.splice(i, 1);
      m.reactions[e] = list;
      broadcast({ t: 'react', id: m.id, e, on, count: list.length, by: p.id });
      return;
    }

    // ----- 라이언 놀이 (대화 봇 실행기) -----
    if (obj.t === 'lion') {
      if (!rateOk(ws)) return;
      const st = botState.get(p.id) || (botState.set(p.id, {}), botState.get(p.id));
      if (obj.kind === 'wordchain' || obj.kind === 'chain') {
        const start = wordFor('가') || '사자';
        st.chain = { need: lastChar(start), last: start };
        lionSay(`끝말잇기 시작! “${start}”! 이제 ‘${lastChar(start)}’로 시작하는 말을 또박또박 써봐! 🎮`);
      } else if (obj.kind === 'math') {
        const pb = mathProblem();
        st.math = pb.ans;
        lionSay(`우진아, ${pb.q} = ? 🤔`);
      } else if (obj.kind === 'flag') {
        const f = randPick(BOT_FLAGS);
        st.flag = f.n;
        lionSay(`이 국기(flag)는 어느 나라일까? ${f.f} 🤔`);
      } else if (obj.kind === 'country') {
        const f = randPick(BOT_FLAGS);
        lionSay(`오늘의 나라 ${f.f} ${f.n}! 수도는 ${f.c}야. ${f.x}`);
      } else if (obj.kind === 'pun') {
        lionSay(randPick(LION.pun));
      } else {
        botMenu(p);
      }
      return;
    }

    // ----- 부모 모드 -----
    if (obj.t === 'parent_enter') {
      if (p.parent) return;
      if (String(obj.pin) === String(PARENT_PIN)) {
        p.parent = true;
        send(ws, { t: 'parent_ok', blocked, mod: modLog.slice(-80), users: snapshot() });
      } else {
        send(ws, { t: 'parent_no' });
      }
      return;
    }
    if (!isParent(ws)) return; // 이 아래는 부모 전용

    if (obj.t === 'parent_block') {
      const w = String(obj.word || '').replace(/\s+/g, '').slice(0, 20);
      if (!w) return;
      if (obj.add && !blocked.some(b => norm(b) === norm(w))) blocked.push(w);
      if (!obj.add) blocked = blocked.filter(b => norm(b) !== norm(w));
      broadcast({ t: 'blocked_update', blocked });
      broadcast({ t: 'sys', text: `지킴이 단어를 ${obj.add ? '추가' : '삭제'}했어요. 🛡️` });
      return;
    }
    if (obj.t === 'parent_kick') {
      for (const [w, q] of users) {
        if (q.id === obj.id && w !== ws) {
          q.kicked = true;
          send(w, { t: 'kicked' });
          setTimeout(() => { try { w.close(); } catch {} }, 400);
        }
      }
      return;
    }
    if (obj.t === 'parent_mute') {
      for (const [w, q] of users) {
        if (q.id === obj.id && w !== ws) {
          q.muted = !!obj.on;
          send(w, { t: 'muted', on: q.muted });
          broadcast({ t: 'users', users: snapshot() });
          broadcast({ t: 'sys', text: `${q.name}님을 ${q.muted ? '조용히 하기(뮤트)' : '다시 말할 수 있게'} 했어요. 🛡️` });
        }
      }
      return;
    }
  };

  ws.on('message', route);
  ws.on('close', () => {
    const p = users.get(ws);
    if (!p) return;
    users.delete(ws);
    botState.delete(p.id);
    lastTyping.delete(p.id);
    broadcast({ t: 'left', id: p.id });
    broadcast({ t: 'users', users: snapshot() });
    if (!p.kicked) broadcast({ t: 'sys', text: `${p.name}님이 조용히 나갔어요. 다음에 또 놀아요! 👋` });
  });
  ws.on('error', () => {});
});

// 헬스체크 핑/퐁
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30_000);
wss.on('connection', (ws) => { ws.on('pong', () => { ws.isAlive = true; }); });

server.listen(PORT, () => {
  console.log(`또박톡 서버 실행 중 → http://localhost:${PORT}`);
  console.log(`부모 모드 PIN: ${PARENT_PIN} (환경변수 PARENT_PIN으로 변경 가능)`);
});
