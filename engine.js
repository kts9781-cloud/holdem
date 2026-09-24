// 홀덤 엔진: DOM 없음. 브라우저는 <script src="engine.js">로, 서버(Supabase Edge Function)는 이 파일에 export를 붙인 engine.mjs로 쓴다
// ===== 엔진: DOM 없음. 좌석 0 = 나, 나머지 = AI. 헤즈업은 2명인 경우 =====
let ITERS = 2000; // 몬테카를로 반복 횟수 (상대가 많으면 줄여 쓴다)
let RNG = Math.random; // 덱 셔플용 난수. 서버는 crypto 난수로 바꿔 끼운다
const CHIP = 100; // 가장 작은 칩. 모든 금액은 100 단위
// 실제 토너먼트처럼 오르는 블라인드
const LEVELS = [[100, 200], [200, 400], [300, 600], [400, 800], [500, 1000], [600, 1200], [800, 1600], [1000, 2000], [1200, 2400],
  [1500, 3000], [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000], [8000, 16000], [10000, 20000]];
// 블라인드 레벨은 G.level. 실제 대회처럼 화면의 토너먼트 시계가 시간으로 올린다 (엔진은 시간을 모른다)
const RANKS = '23456789TJQKA', SUITS = 'shdc', SUIT_GLYPH = '♠♥♦♣';
const rankOf = c => c >> 2, suitOf = c => c & 3;
const card = s => RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]);
const rankLabel = r => r === 8 ? '10' : RANKS[r];
const cardText = c => rankLabel(rankOf(c)) + SUIT_GLYPH[suitOf(c)];
const fmt = n => n.toLocaleString('ko-KR');
const sum = a => a.reduce((s, x) => s + x, 0);
const HAND_NAMES = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

// 랭크 비트마스크에서 스트레이트 최고 랭크 (없으면 -1). A-5 휠은 3('5') 반환.
function straightHigh(m) {
  const w = (m << 1) | ((m >> 12) & 1);
  for (let h = 13; h >= 4; h--) if (((w >> (h - 4)) & 31) === 31) return h - 1;
  return -1;
}

// 5~7장 → 비교 가능한 정수 (클수록 강함). 족보 × 13^5 + 키커 5개.
function evaluate(cs) {
  const rc = new Array(13).fill(0), sc = [0, 0, 0, 0], sm = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cs) { const r = c >> 2, s = c & 3; rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r; }
  const score = (cat, ks) => { let v = cat; for (let i = 0; i < 5; i++) v = v * 13 + (ks[i] ?? 0); return v; };
  // 7장 이하에서 플러시가 있으면 포카드·풀하우스는 불가능하므로 먼저 확인해도 된다
  for (let s = 0; s < 4; s++) if (sc[s] >= 5) {
    const h = straightHigh(sm[s]);
    if (h >= 0) return score(8, [h]);
    const ks = [];
    for (let r = 12; r >= 0 && ks.length < 5; r--) if ((sm[s] >> r) & 1) ks.push(r);
    return score(5, ks);
  }
  const g = [[], [], [], [], []];
  for (let r = 12; r >= 0; r--) g[rc[r]].push(r);
  const [, , pairs, trips, quads] = g;
  const kick = (ex, n) => { const k = []; for (let r = 12; r >= 0 && k.length < n; r--) if (rc[r] && !ex.includes(r)) k.push(r); return k; };
  if (quads.length) return score(7, [quads[0], ...kick([quads[0]], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) return score(6, [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)]);
  const st = straightHigh(mask);
  if (st >= 0) return score(4, [st]);
  if (trips.length) return score(3, [trips[0], ...kick([trips[0]], 2)]);
  if (pairs.length > 1) return score(2, [pairs[0], pairs[1], ...kick(pairs.slice(0, 2), 1)]);
  if (pairs.length) return score(1, [pairs[0], ...kick([pairs[0]], 3)]);
  return score(0, kick([], 5));
}

function handName(score) {
  const cat = Math.floor(score / 13 ** 5);
  return cat === 8 && Math.floor(score / 13 ** 4) % 13 === 12 ? '로열 플러시' : HAND_NAMES[cat];
}

// 7장 중 최고의 5장 (쇼다운 하이라이트용)
function best5(cs) {
  let best = null;
  for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
    const five = cs.filter((_, i) => i !== a && i !== b), s = evaluate(five);
    if (!best || s > best.score) best = { score: s, cards: five };
  }
  return best;
}

// 첸 공식 → 1326개 스타팅 핸드의 백분위 (0 = 최약, 1 = 최강)
function chen(a, b) {
  let r1 = a >> 2, r2 = b >> 2;
  if (r1 < r2) [r1, r2] = [r2, r1];
  const base = r => r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2;
  let s = base(r1);
  if (r1 === r2) return Math.max(5, s * 2);
  if ((a & 3) === (b & 3)) s += 2;
  const gap = r1 - r2 - 1;
  s -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && r1 < 10) s += 1;
  return Math.ceil(s);
}
// [카드a, 카드b, 값] 목록 → 핸드별 백분위 표 (동점은 같은 백분위)
function percentiles(l) {
  const out = new Float32Array(52 * 52);
  l.sort((x, y) => x[2] - y[2]);
  let first = 0;
  l.forEach(([a, b, v], i) => { if (i && v !== l[i - 1][2]) first = i; out[a * 52 + b] = out[b * 52 + a] = first / l.length; });
  return out;
}
const PCT = (() => { const l = []; for (let a = 0; a < 52; a++) for (let b = 0; b < a; b++) l.push([a, b, chen(a, b)]); return percentiles(l); })();
// 상대 레인지 강도표: 프리플랍은 첸 백분위, 플랍부터는 보드 위 현재 족보(65%) + 프리플랍(35%)을 섞어 다시 백분위로
// ponytail: 드로우는 족보로 안 잡혀서 과소평가된다. 더 정교하게 하려면 아웃츠 가중치를 더할 것
function strengthMap(board, dead) {
  if (!board.length) return PCT;
  const l = [];
  for (let a = 0; a < 52; a++) for (let b = 0; b < a; b++) if (!dead.has(a) && !dead.has(b)) l.push([a, b, evaluate([a, b, ...board])]);
  const made = percentiles(l);
  return percentiles(l.map(([a, b]) => [a, b, 0.65 * made[a * 52 + b] + 0.35 * PCT[a * 52 + b]]));
}
// 상대 레인지 컷: 팟 크기 레이즈(공격 강도 1) 한 번이면 "상대가 레이즈하는 빈도(rr)"만큼의 상위 핸드로 좁힌다.
// 아무 패로나 레이즈하는 상대(rr≈1)는 거의 안 좁히고, 골라서 레이즈하는 상대는 크게 좁힌다. 상위 10%보다는 안 좁힌다
const rangeCut = (aggro, rr) => Math.min(0.9, 1 - rr ** aggro);

// 몬테카를로 승률: 상대마다 각자 레인지(강도표에서 cuts[k] 이상)에서 패를 뽑고, 남은 보드는 무작위로. 동점은 나눠 가진다
// 거절 표본추출은 상대별로 따로 (한꺼번에 거절하면 상대가 많을 때 통과율이 곱으로 줄어든다)
function equity(hole, board, cuts, map = PCT, iters = ITERS) {
  const dead = new Set([...hole, ...board]), d = [];
  for (let c = 0; c < 52; c++) if (!dead.has(c)) d.push(c);
  const n = d.length, need = 5 - board.length, me = [...hole, ...board], opp = cuts.map(() => [0, 0, ...board]);
  const rnd = k => Math.floor(Math.random() * k);
  const swap = (i, j) => { const t = d[i]; d[i] = d[j]; d[j] = t; };
  let won = 0;
  for (let it = 0; it < iters; it++) {
    let pos = 0;
    for (let k = 0; k < cuts.length; k++, pos += 2) {
      let tries = 0;
      do { swap(pos, pos + rnd(n - pos)); swap(pos + 1, pos + 1 + rnd(n - pos - 1)); }
      while (cuts[k] > 0 && map[d[pos] * 52 + d[pos + 1]] < cuts[k] && ++tries < 60);
      opp[k][0] = d[pos]; opp[k][1] = d[pos + 1];
    }
    for (let j = 0; j < need; j++) swap(pos + j, pos + j + rnd(n - pos - j));
    const run = d.slice(pos, pos + need), mine = evaluate(me.concat(run));
    let ties = 0, lost = false;
    for (const o of opp) { const s = evaluate(o.concat(run)); if (s > mine) { lost = true; break; } if (s === mine) ties++; }
    if (!lost) won += 1 / (ties + 1);
  }
  return won / iters;
}

// ===== 게임 상태 =====
let G, H;
// opts: names[], styles[], stacks[]
function newGame(o) {
  const n = o.stacks.length;
  // stats: 베팅을 마주한 횟수, 폴드 횟수, 그때마다의 MDF(최소 방어 빈도) 합, 레이즈할 수 있었던 횟수, 실제 레이즈 횟수
  G = { n, names: o.names, styles: o.styles, stacks: o.stacks.slice(), out: Array(n).fill(false), place: Array(n).fill(null),
        level: 0, hand: 0, button: Math.floor(Math.random() * n),
        stats: Array.from({ length: n }, () => ({ faced: 0, folded: 0, mdf: 0, chances: 0, raises: 0 })) };
}
const alive = () => G.stacks.map((_, i) => i).filter(i => !G.out[i]);
const nextOf = (from, ok) => { for (let k = 1; k <= G.n; k++) { const i = (from + k) % G.n; if (ok(i)) return i; } return -1; };
const live = () => H.folded.map((f, i) => f ? -1 : i).filter(i => i >= 0); // 이번 핸드에서 아직 안 접은 사람
const maxBet = () => Math.max(...H.bets);
const allInRunout = () => live().length > 1 && live().filter(i => G.stacks[i] > 0).length <= 1; // 올인으로 더 걸 사람이 없다 → 패를 까고 남은 카드만 깐다
const needsAction = i => !H.folded[i] && G.stacks[i] > 0 && (!H.acted[i] || H.bets[i] < maxBet());
function put(p, x) { x = Math.min(x, G.stacks[p]); G.stacks[p] -= x; H.bets[p] += x; H.committed[p] += x; }

function newHand() {
  if (G.hand) G.button = nextOf(G.button, i => !G.out[i]);
  G.hand++;
  const n = G.n, [sb, bb] = LEVELS[Math.min(G.level, LEVELS.length - 1)], d = [...Array(52).keys()];
  for (let i = 51; i > 0; i--) { const j = Math.floor(RNG() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  const z = () => Array(n).fill(0);
  H = { deck: d, hole: Array.from({ length: n }, () => []), board: [], bets: z(), committed: z(), aggro: z(),
        folded: G.out.slice(), acted: Array(n).fill(false), canRaise: Array(n).fill(true),
        lastRaise: bb, sb, bb, start: G.stacks.slice(), result: null, decision: null, busted: [] };
  for (let r = 0; r < 2; r++) for (let k = 1; k <= n; k++) { const i = (G.button + k) % n; if (!G.out[i]) H.hole[i].push(d.pop()); } // 버튼 왼쪽부터 한 장씩
  // 헤즈업(2명)이면 버튼이 스몰 블라인드, 아니면 버튼 다음이 SB, 그다음이 BB
  H.sbSeat = alive().length === 2 ? G.button : nextOf(G.button, i => !G.out[i]);
  H.bbSeat = nextOf(H.sbSeat, i => !G.out[i]);
  put(H.sbSeat, sb); put(H.bbSeat, bb);
  H.toAct = nextOf(H.bbSeat, needsAction); // 프리플랍은 BB 다음 사람부터 (헤즈업이면 버튼=SB)
}
function legal(p) {
  const mb = maxBet(), owe = mb - H.bets[p];
  const cap = Math.max(0, ...live().filter(i => i !== p).map(i => H.bets[i] + G.stacks[i])); // 아무도 못 받는 만큼은 의미 없음
  const maxTo = Math.min(H.bets[p] + G.stacks[p], cap);
  return { toCall: Math.min(owe, G.stacks[p]), canCheck: owe === 0, canRaise: H.canRaise[p] && maxTo > mb,
           minTo: Math.min(mb + H.lastRaise, maxTo), maxTo };
}
function act(p, type, to) {
  const mb = maxBet(), owe = mb - H.bets[p], before = G.stacks[p], st = G.stats[p], L = legal(p);
  if (owe > 0) { const P = sum(H.committed); st.faced++; st.mdf += (P - owe) / P; }
  if (L.canRaise) { st.chances++; if (type === 'raise') st.raises++; }
  let label;
  if (type === 'raise' && !L.canRaise) type = 'call'; // 레이즈할 수 없으면 콜로 처리
  if (type === 'fold') { st.folded++; H.folded[p] = true; label = '폴드'; }
  else if (type === 'raise') {
    to = Math.max(L.minTo, Math.min(L.maxTo, Math.round(to / CHIP) * CHIP));
    const inc = to - mb, full = inc >= H.lastRaise, verb = mb ? '레이즈' : '베팅';
    const s = inc / (sum(H.committed) + owe); // 공격 강도: 1/2팟 0.75, 팟 1, 큰 올인은 최대 4
    if (full) H.lastRaise = inc;
    // 최소 레이즈 이상이면 모두에게 액션이 다시 열리고, 모자란 올인이면 이미 행동한 사람은 콜/폴드만 할 수 있다
    for (const q of live()) if (q !== p && G.stacks[q] > 0) { if (full) H.canRaise[q] = true; else if (H.acted[q]) H.canRaise[q] = false; H.acted[q] = false; }
    put(p, to - H.bets[p]); H.aggro[p] += Math.min(4, 0.5 + s / 2);
    label = `${verb} ${fmt(H.bets[p])}`;
  } else { put(p, owe); label = owe ? `콜 ${fmt(before - G.stacks[p])}` : '체크'; }
  H.acted[p] = true;
  H.toAct = nextOf(p, needsAction);
  return type === 'fold' || G.stacks[p] ? label : `올인 · ${label}`;
}
function roundOver() {
  const lv = live();
  if (lv.length <= 1) return true;
  const canAct = lv.filter(i => G.stacks[i] > 0);
  // 칩이 남은 사람이 혼자이고 이미 최고 베팅을 맞췄다면 더 할 베팅이 없다
  if (lv.some(needsAction) && !(canAct.length === 1 && H.bets[canAct[0]] >= maxBet())) return false;
  const mb = maxBet(), top = H.bets.indexOf(mb), second = Math.max(0, ...H.bets.filter((_, i) => i !== top));
  if (mb > second) { const ex = mb - second; G.stacks[top] += ex; H.bets[top] -= ex; H.committed[top] -= ex; } // 아무도 받지 못한 초과분 반환
  return true;
}
function nextStreet() {
  const k = H.board.length ? 1 : 3;
  for (let i = 0; i < k; i++) H.board.push(H.deck.pop());
  H.bets.fill(0); H.acted.fill(false); H.canRaise.fill(true); H.lastRaise = H.bb;
  H.toAct = nextOf(G.button, needsAction); // 플랍부터는 버튼 다음 사람부터 (헤즈업이면 BB)
}
// 정산: 올인 금액 층마다 사이드팟을 나누고 층마다 승자를 가린다. 폴드한 사람이 낸 칩도 팟에 남는다
function settle() {
  const n = G.n, lv = live(), total = sum(H.committed), pots = [];
  if (lv.length === 1) pots.push({ amt: total, elig: lv });
  else {
    let prev = 0;
    for (const L of [...new Set(lv.map(i => H.committed[i]))].sort((a, b) => a - b)) {
      let amt = 0;
      for (let i = 0; i < n; i++) amt += Math.max(0, Math.min(H.committed[i], L) - prev);
      pots.push({ amt, elig: lv.filter(i => H.committed[i] >= L) }); prev = L;
    }
    pots[pots.length - 1].amt += total - sum(pots.map(p => p.amt)); // 폴드한 사람이 더 많이 낸 몫(드묾)
  }
  const score = lv.length > 1 ? Object.fromEntries(lv.map(i => [i, evaluate([...H.hole[i], ...H.board])])) : null;
  const order = Array.from({ length: n }, (_, k) => (G.button + 1 + k) % n); // 남는 칩은 버튼 왼쪽부터
  for (const pot of pots) {
    const best = score && Math.max(...pot.elig.map(i => score[i]));
    const win = score ? pot.elig.filter(i => score[i] === best) : pot.elig;
    const unit = Math.floor(pot.amt / CHIP / win.length) * CHIP;
    win.forEach(i => G.stacks[i] += unit);
    let odd = pot.amt - unit * win.length;
    for (const i of order) if (odd && win.includes(i)) { const c = Math.min(CHIP, odd); G.stacks[i] += c; odd -= c; }
    pot.win = win;
  }
  H.result = { pots, win: [...new Set(pots.flatMap(p => p.win))], pot: total, showdown: lv.length > 1, score };
  H.committed.fill(0); H.bets.fill(0);
  // 탈락: 같은 핸드에서 여럿이 떨어지면 핸드 시작 때 칩이 많았던 사람이 더 높은 순위
  const bust = alive().filter(i => G.stacks[i] === 0).sort((a, b) => H.start[b] - H.start[a]);
  const remain = alive().length - bust.length;
  bust.forEach((i, k) => { G.out[i] = true; G.place[i] = remain + 1 + k; });
  if (alive().length === 1) G.place[alive()[0]] = 1;
  H.busted = bust;
}
// 한 단계 진행: 'act'(H.toAct 차례) | 'deal'(카드 깔림) | 'end'(정산 완료)
function step() {
  const many = live().length > 1;
  if (many && !roundOver()) { if (!needsAction(H.toAct)) H.toAct = nextOf(Math.max(0, H.toAct), needsAction); return 'act'; }
  if (many && H.board.length < 5) { nextStreet(); return 'deal'; }
  settle(); return 'end';
}

// ===== AI: 각자 자기 칩 기대값(EV)을 최대화. 서로 편먹지 않고 자기 패와 공개 정보만 본다 =====
// 성격은 계산식은 같고 몇 가지 성향만 다르다.
//  risk: 콜당했을 때 잃을 칩 감점 / bluff·slow: 블러프·슬로플레이 빈도 / realize: 에퀴티 실현율 보정(+면 더 콜)
//  defend: 상대가 얼마나 버틸 거라고 보는지(작을수록 상대가 잘 접는다고 봄) / press: 레이즈 가산점(팟 대비)
const STYLES = {
  pro:     { tag: '정석',   risk: 0.04, bluff: 0.12, slow: 0.15, realize: 0,     defend: 1,    press: 0 },
  rock:    { tag: '바위',   risk: 0.07, bluff: 0.04, slow: 0.08, realize: -0.05, defend: 1.05, press: 0 },
  station: { tag: '콜링',   risk: 0.02, bluff: 0.05, slow: 0.2,  realize: 0.07,  defend: 1.15, press: 0 },
  lag:     { tag: '공격형', risk: 0.03, bluff: 0.25, slow: 0.05, realize: 0.02,  defend: 0.88, press: 0.05 },
};
// ponytail: EV는 이번 베팅 라운드만 본다(이후 스트리트의 임플라이드 오즈 무시). 칩 EV = 승자독식 토너먼트의 우승 확률에 비례한다고 본다(ICM 미적용)
function decide(p) {
  // G.styles[p]: 페르소나(수치 묶음) 또는 성격 이름
  const s0 = G.styles[p], S = typeof s0 === 'object' && s0 ? s0 : STYLES[s0] || STYLES.pro, L = legal(p), mb = maxBet(), opps = live().filter(i => i !== p);
  const myAfter = H.committed[p] + L.toCall;
  const potCall = H.committed.reduce((s, c, i) => s + Math.min(i === p ? myAfter : c, myAfter), 0); // 콜하면 내가 이길 수 있는 팟
  const potAll = sum(H.committed); // 모두 접으면 내가 가져가는 칩
  const map = strengthMap(H.board, new Set([...H.hole[p], ...H.board]));
  // 상대마다 성향을 학습 (사전값에서 시작해 관찰로 갱신). rr: 레이즈 빈도(사전값 75%) / 방어: 1 = MDF만큼 콜
  const rrOf = q => (G.stats[q].raises + 3) / (G.stats[q].chances + 4);
  const defOf = q => (G.stats[q].faced - G.stats[q].folded + 2) / (G.stats[q].mdf + 2) * S.defend;
  const cuts = opps.map(q => rangeCut(H.aggro[q], rrOf(q)));
  const it = Math.max(400, Math.round(ITERS * 2 / (opps.length + 1)));
  const eq = equity(H.hole[p], H.board, cuts, map, it);
  // 에퀴티 실현율: 뒤에 스트리트가 남으면 약한 패는 상대 베팅에 접게 돼 승률을 다 못 챙기고, 강한 패는 더 뽑아낸다 (올인이면 그대로)
  const later = H.board.length < 5;
  const realize = (e, allIn) => later && !allIn ? e * Math.min(1.1, Math.max(0.6, 0.85 + (e - 0.5) + S.realize)) : e;
  const opts = [];
  if (!L.canCheck) opts.push({ type: 'fold', label: '폴드', ev: 0 });
  opts.push({ type: L.canCheck ? 'check' : 'call', label: L.canCheck ? '체크' : '콜', to: H.bets[p] + L.toCall,
              ev: realize(eq, L.toCall >= G.stacks[p] || opps.every(q => !G.stacks[q])) * potCall - L.toCall });
  let sims = it;
  if (L.canRaise) {
    const seen = new Set(), verb = mb ? '레이즈' : '베팅';
    for (const [x, name] of [[0.5, '1/2팟'], [1, '팟'], [Infinity, '올인']]) {
      const to = Math.max(L.minTo, Math.min(L.maxTo, Math.round((mb + x * potCall) / CHIP) * CHIP));
      const risk = to - H.bets[p], P = potAll + risk;
      // 올인은 상대가 낼 돈이 팟의 3배 이하일 때만 (스택이 깊을 때 과도한 오버벳 올인 방지)
      if (seen.has(to) || (to === L.maxTo && to - mb > 3 * potCall)) continue;
      seen.add(to);
      // 상대마다: 크게 걸수록 더 많이 접지만, 콜해 오는 건 레인지 상위 (1-f)뿐. 올인한 상대는 접을 수 없다
      let fAll = 1, reRaisers = 0, expCall = 0;
      const fq = opps.map(q => {
        if (!G.stacks[q]) { fAll = 0; return 0; }
        const call = Math.min(to - H.bets[q], G.stacks[q]), f = Math.min(0.9, Math.max(0, 1 - defOf(q) * (P - call) / P));
        fAll *= f; expCall += (1 - f) * call; if (G.stacks[q] > call) reRaisers++;
        return f;
      });
      const qr = Math.min(1 - fAll, 1 - 0.9 ** reRaisers); // 누군가 다시 레이즈하면 접고 건 돈을 잃는다
      const eqC = equity(H.hole[p], H.board, cuts.map((c, k) => c + (1 - c) * fq[k]), map, it); sims += it;
      const potCalled = P + (fAll < 1 ? expCall / (1 - fAll) : 0);
      opts.push({ type: 'raise', label: to === L.maxTo ? '올인' : `${verb} ${name}`, to, f: fAll, eqC,
                  ev: fAll * potAll + (1 - fAll - qr) * (realize(eqC, to === L.maxTo) * potCalled - risk) - qr * risk + S.press * potCall });
    }
  }
  // 위험 보정: EV 차이가 작으면 콜당했을 때 잃을 칩이 적은 쪽을 고른다
  const riskAdj = x => x.ev - S.risk * (x.type === 'raise' ? (1 - x.f) * (x.to - H.bets[p]) : x.type === 'call' ? L.toCall : 0);
  let pick = opts.reduce((a, b) => riskAdj(b) > riskAdj(a) ? b : a);
  let tag = pick === opts.reduce((a, b) => b.ev > a.ev ? b : a) ? '' : '리스크 회피';
  const r = Math.random();
  if (pick.type === 'raise' && eq > 0.8 && later && r < S.slow) {
    pick = opts.find(x => x.type === 'check' || x.type === 'call'); tag = '슬로플레이';
  } else if (pick.type === 'check' && opts.some(x => x.type === 'raise') && eq < 0.35 && r < S.bluff) {
    pick = opts.find(x => x.type === 'raise'); tag = '블러프';
  }
  const avg = a => a.length ? sum(a) / a.length : 0, seenQ = opps.filter(q => G.stats[q].faced);
  return { type: pick.type, to: pick.to, info: { who: p, eq, opts, pick, tag, iters: sims, street: H.board.length, opps: opps.length,
    cut: avg(cuts), rr: avg(opps.map(rrOf)), foldSeen: seenQ.length ? avg(seenQ.map(q => G.stats[q].folded / G.stats[q].faced)) : null,
    potOdds: L.toCall / (potCall || 1) } };
}

// ===== 셀프 테스트 (?test=1) =====
function selfTest() {
  const E = s => evaluate(s.split(' ').map(card)), cat = s => Math.floor(E(s) / 13 ** 5);
  // 사이드팟 시나리오: 정해진 패·보드로 정산만 확인
  const pot = (stacks, committed, folded, holes, board, button = 0) => {
    const saved = [G, H];
    G = { n: stacks.length, stacks: stacks.slice(), out: stacks.map(() => false), place: stacks.map(() => null), button, hand: 1, level: 0, stats: [] };
    H = { committed: committed.slice(), bets: committed.map(() => 0), folded: folded.slice(), hole: holes.map(h => h ? h.split(' ').map(card) : []),
          board: board.split(' ').map(card), start: committed.map((c, i) => c + stacks[i]) };
    settle();
    const r = { stacks: G.stacks, place: G.place };
    [G, H] = saved;
    return r;
  };
  const cases = [
    ['휠 스트레이트', () => cat('As 2d 3c 4h 5s 9d Kc') === 4],
    ['6 하이 > 휠', () => E('2d 3c 4h 5s 6d Kc Qh') > E('As 2d 3c 4h 5s 9d Kc')],
    ['브로드웨이 > K 하이 스트레이트', () => E('As Kd Qc Jh Ts 2d 3c') > E('Ks Qd Jc Th 9s 2d 3c')],
    ['플러시 > 스트레이트', () => E('2h 7h 9h Jh Kh 3c 4d') > E('5s 6d 7c 8h 9s 2d Kc')],
    ['풀하우스는 트리플이 결정', () => E('Ks Kd Kc 2h 2s 5d 7c') > E('Qs Qd Qc Ah As 5d 7c')],
    ['트리플 두 개 → 풀하우스', () => cat('7s 7d 7c 5h 5s 5d Ac') === 6 && E('7s 7d 7c 5h 5s 5d Ac') === E('7h 7d 7c 5h 5s Kd Ac')],
    ['투페어 키커', () => E('As Ad Ks Kd Qc 2h 3s') > E('As Ad Ks Kd Jc 2h 3s')],
    ['페어 세 개 → 상위 둘 + 키커', () => E('As Ad Ks Kd Qc Qh 2s') === E('As Ad Ks Kd Qc 3h 2s')],
    ['보드 스트레이트는 찹', () => E('2c 3d As Kd Qc Jh Ts') === E('4c 5d As Kd Qc Jh Ts')],
    ['스트레이트 플러시 > 포카드', () => E('5h 6h 7h 8h 9h 9s 9d') > E('As Ad Ac Ah Kd 2s 3c')],
    ['6장 플러시는 상위 5장', () => E('Ah Kh 9h 7h 4h 2h 3c') === E('Ah Kh 9h 7h 4h 3h 3c')],
    ['포카드 키커', () => E('9s 9d 9c 9h As 2d 3c') > E('9s 9d 9c 9h Ks Qd Jc')],
    ['로열 플러시 이름', () => handName(E('As Ks Qs Js Ts 2d 3c')) === '로열 플러시'],
    ['best5 = 7장 평가', () => { const cs = 'Ks Kd Kc 2h 2s 5d 7c'.split(' ').map(card); return best5(cs).score === evaluate(cs); }],
    ['프리플랍 백분위', () => PCT[card('As') * 52 + card('Ah')] > 0.95 && PCT[card('7s') * 52 + card('2d')] < 0.1],
    // 0: 1,000 올인(최강), 1: 3,000 올인(중간), 2: 5,000(최약), 3: 2,000 내고 폴드 → 메인 4,000은 0, 사이드 5,000은 1, 남는 2,000은 2
    ['사이드팟: 짧은 올인이 이기면 메인만', () => { const r = pot([0, 0, 0, 1000], [1000, 3000, 5000, 2000], [false, false, false, true],
      ['As Ad', 'Ks Kd', '7c 2h', '9s 9d'], 'Ah Kh 5c 3d 8s');
      return r.stacks.join() === '4000,5000,2000,1000' && r.place.every(x => x === null); }],
    ['사이드팟: 세 명 나눠먹기 + 남는 칩', () => { const r = pot([0, 0, 0], [300, 300, 300], [false, false, false],
      ['2c 3c', '2d 3d', '2h 3h'], 'As Ks Qs Js 9d', 0); // 보드 플레이 → 900을 셋이 300씩
      return r.stacks.join() === '300,300,300'; }],
    ['남는 1칩은 버튼 왼쪽부터', () => { const r = pot([0, 0, 1000], [100, 100, 100], [false, false, true],
      ['2c 3c', '2d 3d', '7h 8h'], 'As Ks Qs Js 9d', 0); // 300을 둘이: 100씩 + 남는 100은 버튼(0) 왼쪽인 1에게
      return r.stacks.join() === '100,200,1000'; }],
    ['폴드한 사람의 칩도 팟에 남는다', () => { const r = pot([0, 500, 0], [400, 400, 200], [false, false, true],
      ['As Ad', '7c 2h', 'Ks Kd'], 'Ah Kh 5c 3d 8s');
      return r.stacks.join() === '1000,500,0'; }],
  ];
  return { total: cases.length, fails: cases.filter(([, f]) => { try { return !f(); } catch (e) { return true; } }).map(([n]) => n) };
}

// ===== 페르소나: 게임마다 이름·소개·성격·성향 수치를 무작위로 (서버도 AI 자리를 채울 때 쓴다) =====
const NAME_POOL = ['빅토르', '민지', '레오', '사쿠라', '도윤', '엘레나', '마르코', '하나', '제이크', '수아', '이반', '루시아', '카이', '나탈리', '오스카', '유나'];
// 소개는 성격과 상관없는 배경만. 성격은 게임 중에 숨기고 토너먼트가 끝나면 공개한다 (쳐 보면서 읽어 내는 재미)
const BIOS = ['부산에서 횟집을 하는 사장님', '수학과 대학원생', '은퇴한 프로야구 선수', '라스베이거스 딜러 출신', '스타트업 대표', '웹툰 작가',
  '주말마다 홈게임을 여는 회사원', '마카오에서 막 돌아온 여행자', '체스 국가대표 출신', '전직 증권사 트레이더', '동네 카페 로스터', '의대 졸업반',
  '택시 기사 20년 경력', '해외 대회 첫 출전', '포커 유튜브 채널 운영자', '은퇴한 고등학교 교사'];
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function persona() {
  const key = pickOne(Object.keys(STYLES)), b = STYLES[key], j = () => 0.8 + Math.random() * 0.4; // 같은 성격이어도 ±20% 흔든다
  return { bio: pickOne(BIOS), style: { tag: b.tag, risk: b.risk * j(), bluff: b.bluff * j(), slow: b.slow * j(), realize: b.realize * j(),
    defend: b.defend * (0.95 + Math.random() * 0.1), press: b.press * j() } };
}
