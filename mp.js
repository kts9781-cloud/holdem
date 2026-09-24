// 친구와 같이 치기 (원격 드라이버). 판정은 서버(Supabase Edge Function `table`)가 하고,
// 여기서는 이벤트를 순서대로 받아 기존 연출(딜·칩·쇼다운)로 재생한다. 남의 패는 쇼다운 전에 오지 않는다.
// 내 좌석이 항상 아래(화면 0번)에 오도록 서버 좌석을 회전해서 보여 준다.
const SUPA_URL = 'https://kxhmazdqgcfbjadgcczf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aG1hemRxZ2NmYmphZGdjY3pmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjAyODAsImV4cCI6MjEwNTc5NjI4MH0.H85z5TqLL8TKpQK9vpkrjYKWzy5gIbhslxPa9SeqaWA'; // 공개용 anon 키 (권한은 RLS로 막는다)
let sb = null;
const MP = { id: null, code: null, me: null, seat: 0, n: 0, users: [], host: null, lastSeq: 0, queue: [], pumping: false,
             skew: 0, deadline: null, nextHandAt: null, tickAt: 0, subs: [], watch: null, poll: null, waitCh: null };
const L = s => (s - MP.seat + MP.n) % MP.n;                                  // 서버 좌석 → 화면 좌석
const rot = a => a && Array.from({ length: MP.n }, (_, i) => a[(i + MP.seat) % MP.n]); // 서버 배열 → 화면 배열
const serverNow = () => Date.now() + MP.skew;
const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

async function mpClient() {
  if (sb) return sb;
  sb = supabase.createClient(SUPA_URL, SUPA_KEY);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { const { error } = await sb.auth.signInAnonymously(); if (error) throw new Error('로그인에 실패했어요: ' + error.message); }
  MP.me = (await sb.auth.getUser()).data.user.id;
  return sb;
}
async function mpCall(op, body = {}) {
  const { data, error } = await sb.functions.invoke('table', { body: { op, ...body } });
  if (error) { let msg = '서버에 연결하지 못했어요'; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  return data;
}

// ===== 로비 시트: 닉네임 → 방 만들기/참가 → 대기실 =====
const sheet = html => { $('mpBody').innerHTML = html; $('mpSheet').hidden = false; $('lobby').hidden = true; };
const sheetErr = m => { const el = $('mpErr'); if (el) el.textContent = m; };
async function mpOpen(code) {
  sheet('<h2>친구와 치기</h2><p>연결하는 중…</p>');
  try { await mpClient(); } catch (e) { sheet(`<h2>친구와 치기</h2><p>${esc(e.message)}</p><button class="btn wide" onclick="mpClose()">돌아가기</button>`); return; }
  const { data: prof } = await sb.from('profiles').select('nickname').eq('id', MP.me).maybeSingle();
  if (!prof) return mpNick(code);
  code ? mpJoin(code) : mpMenu(prof.nickname);
}
function mpNick(code) {
  sheet(`<h2>닉네임</h2><p>친구들에게 보일 이름이에요 (12자까지)</p>
    <input class="mp-input" id="mpNick" maxlength="12" placeholder="예: 태성" autocomplete="nickname">
    <p class="mp-err" id="mpErr"></p>
    <div class="row"><button class="btn primary" id="mpNickOk">확인</button><button class="btn" onclick="mpClose()">취소</button></div>`);
  const go = async () => {
    try { const r = await mpCall('profile', { nickname: $('mpNick').value }); code ? mpJoin(code) : mpMenu(r.nickname); }
    catch (e) { sheetErr(e.message); }
  };
  $('mpNickOk').onclick = go; $('mpNick').onkeydown = e => e.key === 'Enter' && go(); if (matchMedia('(pointer: fine)').matches) $('mpNick').focus(); // iOS는 자동 포커스하면 탭해도 키보드가 안 뜬다
}
function mpMenu(nick) {
  sheet(`<h2>친구와 치기</h2><p>${nick ? esc(nick) + ' 님, ' : ''}방을 만들거나 코드로 들어가세요. 빈자리는 AI가 채워요</p>
    <div class="mp-seats">${[2, 6, 9].map(n => `<button class="mode" data-seats="${n}"><b>${n === 2 ? '1:1 헤즈업' : `${n}인 테이블`}</b><span>${n === 2 ? '친구와 둘이' : `최대 ${n}명 · 빈자리는 AI`}</span></button>`).join('')}</div>
    <div class="mp-join"><input class="mp-input" id="mpCode" maxlength="6" placeholder="초대 코드 6자리" autocapitalize="characters"><button class="btn primary" id="mpJoinBtn">참가</button></div>
    <p class="mp-err" id="mpErr"></p>
    <button class="btn wide ghost" onclick="mpClose()">돌아가기</button>`);
  document.querySelectorAll('[data-seats]').forEach(b => b.onclick = async () => {
    try { const r = await mpCall('create', { seats: +b.dataset.seats }); MP.id = r.id; MP.code = r.code; mpWait(); } catch (e) { sheetErr(e.message); }
  });
  $('mpJoinBtn').onclick = () => mpJoin($('mpCode').value);
  $('mpCode').onkeydown = e => e.key === 'Enter' && mpJoin($('mpCode').value);
}
async function mpJoin(code) {
  try {
    const r = await mpCall('join', { code });
    MP.id = r.id;
    const { data: T } = await sb.from('tables').select('code, status').eq('id', MP.id).single();
    MP.code = T.code;
    history.replaceState(null, '', location.pathname); // 주소창의 ?room= 정리
    T.status === 'waiting' ? mpWait() : mpEnterGame(); // 이미 시작했으면 재접속
  } catch (e) { if (!$('mpErr')) mpMenu(''); sheetErr(e.message); }
}
async function mpWait() {
  const link = `${location.origin}${location.pathname}?room=${MP.code}`;
  const draw = async () => {
    const { data: T } = await sb.from('tables').select('host, seats, status').eq('id', MP.id).single();
    if (T.status !== 'waiting') { mpUnsubWait(); return mpEnterGame(); }
    const { data: ps } = await sb.from('table_players').select('seat, user_id, nickname').eq('table_id', MP.id).order('seat');
    MP.host = T.host;
    const key = JSON.stringify([T, ps]);
    if (key === MP.waitKey) return; // 바뀐 게 없으면 그대로 (다시 그리면 그 순간의 탭이 사라진다)
    MP.waitKey = key;
    sheet(`<h2>대기실</h2><p>코드 <b class="mp-code">${MP.code}</b> · ${ps.length}/${T.seats}명</p>
      <div class="mp-link"><input class="mp-input" readonly value="${esc(link)}"><button class="btn" id="mpCopy">링크 복사</button></div>
      <ol class="standings">${Array.from({ length: T.seats }, (_, s) => { const p = ps.find(x => x.seat === s);
        return `<li class="${p && p.user_id === MP.me ? 'me' : ''}"><span>${s + 1}번</span><span>${p ? esc(p.nickname) + (p.user_id === T.host ? ' · 방장' : '') : 'AI가 채울 자리'}</span><span></span></li>`; }).join('')}</ol>
      <p class="mp-err" id="mpErr"></p>
      <div class="row">${T.host === MP.me ? '<button class="btn primary" id="mpStart">시작하기</button>' : '<button class="btn" disabled>방장이 시작하길 기다리는 중…</button>'}<button class="btn" onclick="mpClose()">나가기</button></div>`);
    $('mpCopy').onclick = async () => { try { await navigator.clipboard.writeText(link); $('mpCopy').textContent = '복사했어요'; } catch { $('mpCopy').textContent = '길게 눌러 복사'; } };
    if ($('mpStart')) $('mpStart').onclick = async () => { try { $('mpStart').disabled = true; await mpCall('start', { id: MP.id }); } catch (e) { sheetErr(e.message); $('mpStart').disabled = false; } };
  };
  mpUnsubWait();
  MP.waitCh = sb.channel('wait-' + MP.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'table_players', filter: `table_id=eq.${MP.id}` }, draw)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter: `id=eq.${MP.id}` }, draw)
    .subscribe();
  MP.waitPoll = setInterval(draw, 4000); // 실시간이 끊겨도 따라오게
  draw();
}
function mpUnsubWait() { if (MP.waitCh) sb.removeChannel(MP.waitCh); MP.waitCh = null; clearInterval(MP.waitPoll); MP.waitKey = null; }
function mpClose() { mpUnsubWait(); $('mpSheet').hidden = true; showLobby(); }

// ===== 게임 =====
async function mpEnterGame() {
  run++; stopClock(); clearInterval(nextTimer); clearInterval(tourTimer);
  mode = 'mp';
  const { data: T } = await sb.from('tables').select('public, seq, status').eq('id', MP.id).single();
  const P = T.public;
  MP.n = P.n; MP.users = P.users; MP.seat = P.users.indexOf(MP.me); MP.lastSeq = T.seq; MP.queue = [];
  MP.deadline = P.deadline; MP.nextHandAt = P.nextHandAt; MP.skew = 0;
  G = { n: P.n, names: rot(P.names), styles: Array(P.n).fill(null), stacks: rot(P.stacks), out: rot(P.out), place: rot(P.place), button: L(P.button),
        hand: P.hand, level: P.level, levelEnds: performance.now() + (P.levelEnds - Date.now()), timeChips: P.timeChips[MP.seat],
        sitOut: rot(P.sitOut), stats: Array.from({ length: P.n }, () => ({})) };
  G.stats[0] = loadProfile();
  const mine = await mpMyCards(P.hand);
  H = { hole: Array.from({ length: P.n }, (_, i) => G.out[i] ? [] : i === 0 ? mine : [-1, -1]), board: P.board, bets: rot(P.bets), committed: rot(P.committed),
        folded: rot(P.folded), canRaise: rot(P.canRaise), lastRaise: P.lastRaise, toAct: P.toAct >= 0 ? L(P.toAct) : -1, bb: P.bb, sb: P.sb,
        sbSeat: L(P.sbSeat), bbSeat: L(P.bbSeat), result: null, decision: null, busted: [] };
  bios = Array(P.n).fill('');
  $('mpSheet').hidden = true; $('lobby').hidden = true; $('endModal').hidden = true;
  $('modeName').textContent = '친구와 치기'; $('modeSub').textContent = `코드 ${MP.code} · ${P.n}인`;
  $('log').textContent = ''; log(`친구와 치기 · 코드 ${MP.code} · 블라인드는 5분마다 올라요`, 'head');
  $('cheat').checked = false; $('cheat').disabled = true; // 친구 패를 엿볼 수 있으므로 멀티에서는 막는다
  buildTable(); renderRecord(); renderProfile();
  $('board').textContent = ''; $('board')._cards = [];
  phase = P.phase === 'over' ? 'over' : P.phase === 'between' ? 'end' : H.toAct === 0 ? 'player' : 'wait';
  if (phase === 'end') H.result = { pots: [], pot: 0, showdown: false, win: [] };
  render();
  if (phase === 'player') mpMyTurn();
  else if (H.toAct >= 0 && phase === 'wait') mpClock();
  tourTimer = setInterval(renderBlinds, 1000);
  mpSubscribe();
  if (P.phase === 'over') mpEnd({ place: P.place, styles: P.styles });
}
async function mpMyCards(hand) {
  for (let i = 0; i < 5; i++) {
    const { data } = await sb.from('hole_cards').select('hand, cards').eq('table_id', MP.id).eq('user_id', MP.me).maybeSingle();
    if (data && data.hand === hand) return data.cards;
    if (!data) return [];
    await new Promise(r => setTimeout(r, 300));
  }
  return [];
}
function mpSubscribe() {
  mpUnsub();
  MP.subs.push(sb.channel('ev-' + MP.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'table_events', filter: `table_id=eq.${MP.id}` }, p => mpReceive([p.new]))
    .subscribe());
  MP.poll = setInterval(mpPoll, 4000); // 실시간 이벤트를 놓쳐도 빈 번호를 채운다
  MP.watch = setInterval(mpWatch, 500);
}
function mpUnsub() { MP.subs.forEach(c => sb.removeChannel(c)); MP.subs = []; clearInterval(MP.poll); clearInterval(MP.watch); }
async function mpPoll() {
  const { data } = await sb.from('table_events').select('seq, payload').eq('table_id', MP.id).gt('seq', MP.lastSeq).order('seq');
  if (data?.length) mpReceive(data);
}
function mpReceive(rows) {
  for (const r of rows) if (r.seq > MP.lastSeq && !MP.queue.some(q => q.seq === r.seq)) MP.queue.push(r);
  MP.queue.sort((a, b) => a.seq - b.seq);
  mpPump();
}
async function mpPump() {
  if (MP.pumping) return;
  MP.pumping = true;
  try {
    while (MP.queue.length && mode === 'mp') {
      const r = MP.queue[0];
      if (r.seq <= MP.lastSeq) { MP.queue.shift(); continue; }
      if (r.seq !== MP.lastSeq + 1) { await mpPoll(); if (MP.queue[0].seq !== MP.lastSeq + 1) break; continue; } // 빠진 번호부터
      MP.queue.shift(); MP.lastSeq = r.seq;
      await mpApply(r.payload);
    }
  } finally { MP.pumping = false; INSTANT = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode === 'mp') mpPoll(); }); // 돌아오면 바로 따라잡기
// 시간이 지났는데 아무도 처리하지 않았다면 서버에 알린다 (서버가 시각을 다시 확인한다)
function mpWatch() {
  const now = serverNow();
  if (mode !== 'mp' || MP.pumping || MP.queue.length || now < MP.tickAt) return;
  const due = (phase === 'player' || phase === 'wait') && MP.deadline && now > MP.deadline + 800
           || phase === 'end' && MP.nextHandAt && now > MP.nextHandAt + 300;
  if (!due) return;
  MP.tickAt = now + 1500;
  mpCall('tick', { id: MP.id }).then(mpPoll, () => {});
}
function mpClock() { startClock(MP.deadline - serverNow()); }
function mpMyTurn() {
  const Lg = legal(0), sl = $('slider');
  sl.max = Lg.maxTo; sl.min = Lg.minTo; sl.value = Lg.minTo;
  buildPresets();
  phase = 'player'; render(); mpClock();
}
async function mpAct(type, to) {
  if (phase !== 'player') return;
  stopClock(); phase = 'busy'; render();
  try { await mpCall('act', { id: MP.id, type, to }); mpPoll(); }
  catch (e) { log(e.message, 'level'); phase = 'player'; render(); mpClock(); }
}
async function mpTimeChip() {
  if (phase !== 'player' || !G.timeChips) return;
  try { await mpCall('timechip', { id: MP.id }); mpPoll(); } catch (e) { log(e.message, 'level'); }
}
async function mpBack() { try { await mpCall('back', { id: MP.id }); mpPoll(); } catch (e) { log(e.message, 'level'); } }
async function mpLeave() { // 게임 중 나가기 = 자리 비움 (코드나 링크로 다시 들어오면 이어서)
  if (MP.id && phase !== 'over') { try { await mpCall('leave', { id: MP.id }); } catch {} }
  mpUnsub(); mode = 'hu'; $('cheat').disabled = false;
}

async function mpApply(e) {
  const me = run;
  INSTANT = document.hidden || MP.queue.length > 3; // 가려진 화면·밀린 이벤트는 연출 없이 따라잡는다
  if (e.now) MP.skew = e.now - Date.now();
  const s = e.seat !== undefined ? L(e.seat) : null;
  const snap = () => { if (!e.stacks) return;
    G.stacks = rot(e.stacks); H.bets = rot(e.bets); H.committed = rot(e.committed); H.folded = rot(e.folded);
    H.canRaise = rot(e.canRaise); H.lastRaise = e.lastRaise; G.out = rot(e.out); H.toAct = e.toAct >= 0 ? L(e.toAct) : -1; };
  switch (e.t) {
    case 'hand': {
      const levelUp = G.hand && e.level !== G.level;
      G.hand = e.hand; G.button = L(e.button); G.level = e.level; G.levelEnds = performance.now() + (e.levelEnds - serverNow()); G.announced = false;
      MP.nextHandAt = null; clearInterval(nextTimer);
      H = { hole: [], board: [], bb: e.bb, sb: e.sb, sbSeat: L(e.sbSeat), bbSeat: L(e.bbSeat), result: null, decision: null, busted: [],
            bets: [], committed: [], folded: [], canRaise: [], lastRaise: e.bb, toAct: -1 };
      snap();
      const mine = await mpMyCards(e.hand), dealt = rot(e.dealt);
      H.hole = dealt.map((d, i) => !d ? [] : i === 0 ? mine : [-1, -1]);
      for (let i = 0; i < G.n; i++) { say(i, G.sitOut[i] ? '자리 비움' : ''); $('hname' + i).textContent = ''; $('seat' + i).classList.remove('win'); }
      $('board').textContent = ''; $('board')._cards = [];
      log(`핸드 #${G.hand} · 딜러 버튼 ${who(G.button)}`, 'head');
      phase = 'deal'; dealing = true; render(); moveDealer();
      if (levelUp) { const [sbl, bbl] = LEVELS[G.level]; flashBanner('블라인드 상승', `레벨 ${G.level + 1} · ${fmt(sbl)}/${fmt(bbl)}`); log(`블라인드 상승 → ${fmt(sbl)}/${fmt(bbl)}`, 'level'); sfx('level'); }
      say(H.sbSeat, 'SB ' + fmt(H.bets[H.sbSeat])); say(H.bbSeat, 'BB ' + fmt(H.bets[H.bbSeat]));
      await dealAnim(); dealing = false;
      return;
    }
    case 'act': {
      if (!MP.users[e.seat] && !e.auto) { phase = 'ai'; H.toAct = s; render(); await sleep(G.n > 2 ? 650 : 1000); } // AI가 생각하는 시간
      if (me !== run) return;
      stopClock();
      say(s, e.label); log(`${who(s)}: ${e.label}${e.timeout ? ' (시간 초과)' : e.auto ? ' (자리 비움)' : ''}`); actSound(e.label);
      if (e.type === 'fold') await muckAnim(s); else if (e.paid > 0) await chipFly(s, e.paid);
      snap(); phase = 'deal'; render();
      return;
    }
    case 'deal': {
      await collectAnim();
      H.board = e.board.slice(); snap();
      const k = H.board.length;
      log(`${STREET[k]}  ${H.board.slice(k === 3 ? 0 : -1).map(cardText).join(' ')}`, 'street');
      for (const i of live()) if (G.stacks[i] && !G.sitOut[i]) say(i, '');
      phase = 'deal'; render();
      await sleep(live().filter(i => G.stacks[i]).length > 1 ? 650 : 1100);
      return;
    }
    case 'turn': {
      snap(); MP.deadline = e.deadline;
      if (s === 0) mpMyTurn(); else { phase = 'wait'; render(); mpClock(); }
      return;
    }
    case 'timechip':
      MP.deadline = e.deadline;
      if (s === 0) G.timeChips = e.left;
      log(`${who(s)} 타임칩 사용 · +30초`, 'street'); sfx('chip');
      if (H.toAct === s) { mpClock(); render(); }
      return;
    case 'away': G.sitOut[s] = true; say(s, '자리 비움'); log(`${who(s)} 자리 비움`, 'street'); render(); return;
    case 'back': G.sitOut[s] = false; say(s, ''); log(`${who(s)} 복귀`, 'street'); render(); return;
    case 'end': return mpEndHand(e, me);
    case 'next':
      MP.nextHandAt = e.at;
      { const tickBtn = () => { const left = Math.max(0, Math.ceil((MP.nextHandAt - serverNow()) / 1000)); $('bNext').textContent = left ? `다음 핸드 (${left})` : '다음 핸드 준비 중…'; };
        clearInterval(nextTimer); tickBtn(); nextTimer = setInterval(tickBtn, 500); }
      return;
    case 'over': return mpEnd(e);
  }
}
async function mpEndHand(e, me) {
  phase = 'end'; stopClock();
  await collectAnim();
  setChipset($('pile'), e.pot, 2, 5, 10);
  H.folded = rot(e.folded);
  H.result = { pots: e.pots.map(p => ({ amt: p.amt, win: p.win.map(L) })), pot: e.pot, showdown: e.showdown };
  H.result.win = [...new Set(H.result.pots.flatMap(p => p.win))];
  if (e.showdown) for (const [ss, cards] of Object.entries(e.show)) H.hole[L(+ss)] = cards;
  const b = e.showdown ? Object.fromEntries(live().map(i => [i, best5([...H.hole[i], ...H.board])])) : null;
  for (let i = 0; i < G.n; i++) renderHole(i);
  if (b) {
    for (const i of live()) $('hname' + i).textContent = handName(b[i].score);
    const hot = new Set(H.result.pots[0].win.flatMap(i => b[i].cards));
    document.querySelectorAll('#board .card, #seats .card[data-c]').forEach(el => el.classList.add(hot.has(+el.dataset.c) ? 'win' : 'dim'));
    log(`쇼다운 · ${live().map(i => `${who(i)} ${handName(b[i].score)}${i ? ` (${H.hole[i].map(cardText).join(' ')})` : ''}`).join(' / ')}`);
    await sleep(1300);
  } else await sleep(300);
  if (me !== run) return;
  await payoutAnim(H.result.pots);
  G.stacks = rot(e.stacks); G.out = rot(e.out); G.place = rot(e.place);
  for (const i of H.result.win) $('seat' + i).classList.add('win');
  for (let i = 0; i < G.n; i++) countStack(i);
  const heroWon = H.result.win.includes(0);
  sfx(heroWon ? 'win' : H.folded[0] ? 'chip' : 'lose');
  const main = H.result.pots[0], names = main.win.map(who).join(' · ');
  $('banner').className = 'banner ' + (main.win.includes(0) ? (main.win.length > 1 ? 'tie' : 'win') : 'lose');
  $('banner').innerHTML = `<strong>${main.win.length > 1 ? `${esc(names)} 나눠 가짐` : `${esc(names)} 승리`}</strong><span>팟 ${fmt(e.pot)} · ${
    b ? handName(b[main.win[0]].score) : '모두 폴드'}${H.result.pots.length > 1 ? ` · 사이드팟 ${H.result.pots.length - 1}개` : ''}</span>`;
  H.result.pots.forEach((p, k) => log(`${k ? `사이드팟 ${k}` : '팟'} ${fmt(p.amt)} → ${p.win.map(who).join(' · ')}`, 'result'));
  H.busted = e.busted.map(L);
  for (const i of H.busted) { const bd = $('badge' + i); bd.hidden = false; bd.textContent = `${G.place[i]}위`; $('seat' + i).classList.add('out'); log(`${who(i)} 탈락 · ${G.place[i]}위`, 'level'); }
  const D = e.decisions[e.decisions.length - 1]; // EV 계기판: 이번 핸드 AI의 마지막 판단 (핸드가 끝난 뒤에만 온다)
  if (D) H.decision = { ...D, who: L(D.who) };
  H.committed = Array(G.n).fill(0); H.bets = Array(G.n).fill(0);
  render();
}
function mpEnd(e) {
  stopClock(); clearInterval(nextTimer); clearInterval(tourTimer); mpUnsub(); phase = 'over';
  const place = rot(e.place), styles = e.styles ? rot(e.styles) : [], mine = place[0];
  $('endTitle').textContent = mine === 1 ? '우승!' : mine ? `${mine}위` : '게임 종료';
  $('endSub').textContent = `친구와 치기 · ${G.hand}핸드${styles.some(Boolean) ? ' · AI 성향 공개' : ''}`;
  const rows = G.names.map((nm, i) => ({ i, nm, place: place[i] })).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  $('standings').innerHTML = rows.map(r => `<li class="${r.i ? '' : 'me'}"><span>${r.place ? r.place + '위' : '진행 중'}</span><span>${esc(r.nm)}${styles[r.i] ? ` · AI ${styles[r.i]}` : ''}</span><span>${r.place ? '' : fmt(G.stacks[r.i]) + '칩'}</span></li>`).join('');
  $('bAgain').hidden = true;
  $('endModal').hidden = false;
  sfx(mine === 1 ? 'win' : 'lose');
  if (mine === 1) chipRain();
  render();
}
