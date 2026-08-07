// ============================================================
// scripts/check-online.mjs — 온라인 대전이 될 상태인지 점검한다.
//
// Firebase 쪽 설정이 갖춰져야 돌아간다:
//   1) Authentication → 익명 로그인(Anonymous)   — 게스트로 바로 플레이
//   2) Authentication → 이메일/비밀번호           — 계정으로 다른 기기에서 이어하기
//   3) firestore.rules 배포                        — 기지 공개 · 습격 리포트 · 계정 저장
//
// 브라우저에서는 "상대가 아무도 없다"로만 보여서 둘 중 무엇이 빠졌는지
// 알기 어렵다. 이 스크립트는 프로젝트에 직접 물어봐서 무엇이 빠졌는지 알려준다.
//
// 실행: node scripts/check-online.mjs
// ============================================================
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/firebase-config.js', import.meta.url), 'utf8');
const pick = (key) => (src.match(new RegExp(`${key}:\\s*"([^"]*)"`)) || [])[1] || '';
const apiKey = pick('apiKey');
const projectId = pick('projectId');
const functionsDeployed = /FUNCTIONS_DEPLOYED\s*=\s*true/.test(src);

console.log(`▶ 프로젝트: ${projectId || '(없음)'}`);
if (!apiKey || apiKey === 'YOUR_API_KEY') {
  console.log('❌ js/firebase-config.js에 Firebase 설정이 없습니다 — 온라인 대전 불가 (로컬 대전만 가능)');
  process.exit(1);
}

const REST = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const problems = [];

async function req(url, init = {}, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* 본문 없음 */ }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, body: null, error: e.message || String(e) };
  } finally { clearTimeout(t); }
}

// 1) 익명 로그인이 켜져 있는가
console.log('\n[1/4] 익명 로그인 (게스트 플레이용)');
const auth = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ returnSecureToken: true }),
});
let idToken = null;
const authBody = JSON.stringify(auth.body || {});
if (auth.status === 200 && auth.body?.idToken) {
  idToken = auth.body.idToken;
  console.log('  ✓ 켜져 있음 (익명 계정 발급됨)');
} else if (/CONFIGURATION_NOT_FOUND/.test(authBody)) {
  // Authentication 자체를 한 번도 켠 적이 없는 프로젝트에서 나오는 응답이다
  console.log('  ❌ Authentication이 아직 설정되지 않았습니다');
  problems.push('Firebase 콘솔 → Authentication → "시작하기" → Sign-in method에서 익명(Anonymous) 사용 설정');
} else if (/OPERATION_NOT_ALLOWED/.test(authBody)) {
  console.log('  ❌ 익명 로그인이 꺼져 있습니다');
  problems.push('Firebase 콘솔 → Authentication → Sign-in method → 익명(Anonymous) 사용 설정');
} else if (auth.status === 0) {
  console.log(`  ⚠️ 확인 불가 (${auth.error}) — identitytoolkit.googleapis.com에 닿지 못했습니다`);
  problems.push('네트워크에서 identitytoolkit.googleapis.com 접근 허용 (또는 브라우저에서 직접 확인)');
} else {
  console.log(`  ⚠️ 예상 밖 응답 ${auth.status}: ${authBody.slice(0, 200)}`);
  problems.push(`익명 로그인 응답을 확인하세요 (HTTP ${auth.status})`);
}

// 1-2) 이메일/비밀번호 로그인 — 계정으로 "이어서 하기"에 필요하다
console.log('\n[2/4] 이메일/비밀번호 로그인 (계정 이어하기용)');
const probeEmail = `check_${Date.now()}@example.com`;
const signup = await req(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: probeEmail, password: 'check1234', returnSecureToken: true }),
});
let emailToken = null;
if (signup.status === 200 && signup.body?.idToken) {
  emailToken = signup.body.idToken;
  console.log('  ✓ 켜져 있음');
  // 시험 계정은 바로 지운다
  await req(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: emailToken }),
  });
} else if (/OPERATION_NOT_ALLOWED/.test(JSON.stringify(signup.body))) {
  console.log('  ❌ 꺼져 있음 — 계정 없이 게스트로만 플레이됩니다');
  problems.push('Firebase 콘솔 → Authentication → Sign-in method → 이메일/비밀번호 사용 설정');
} else {
  console.log(`  ⚠️ 확인 불가 (${signup.status}) ${JSON.stringify(signup.body).slice(0, 120)}`);
}

// 2) 국가 목록을 읽을 수 있는가 (상대를 찾으려면 읽기가 열려 있어야 한다)
console.log('\n[3/4] 국가 목록 읽기 (nations)');
const read = await req(`${REST}/nations`);
if (read.status === 200) {
  const n = (read.body?.documents || []).length;
  console.log(`  ✓ 읽기 가능 — 등록된 국가 ${n}개`);
} else {
  console.log(`  ❌ 읽기 실패 ${read.status}: ${JSON.stringify(read.body).slice(0, 200)}`);
  problems.push('firestore.rules 배포: firebase deploy --only firestore:rules');
}

// 3) 습격 리포트 컬렉션에 규칙이 배포됐는가
//    배포 전에는 raids 규칙 자체가 없어 기본 거부(PERMISSION_DENIED)가 난다.
console.log('\n[4/4] 습격 리포트 · 계정 저장 규칙 (raids · saves)');
// 게임이 실제로 보내는 질의로 확인해야 한다. 컬렉션 전체를 훑는 조회는
// **규칙이 제대로 배포돼 있어도** 거부되는 게 정상이다 — 규칙이 문서마다
// "내가 당사자인가"를 따지므로, 그 조건에 맞는 필터가 질의에 있어야 한다.
const myUid = idToken
  ? JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString()).user_id
  : null;
if (idToken) {
  const raids = await req(`${REST}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'raids' }],
        where: { fieldFilter: { field: { fieldPath: 'defenderId' }, op: 'EQUAL', value: { stringValue: myUid } } },
        limit: 1,
      },
    }),
  });
  if (raids.status === 200) {
    console.log('  ✓ 습격 리포트 규칙 배포됨');
  } else if (raids.status === 403) {
    console.log('  ❌ 거부됨 — raids 규칙이 아직 배포되지 않았습니다');
    problems.push('firestore.rules 배포: firebase deploy --only firestore:rules');
  } else {
    console.log(`  ⚠️ 예상 밖 응답 ${raids.status}: ${JSON.stringify(raids.body).slice(0, 200)}`);
  }
} else {
  console.log('  ⚠️ 판정 불가 — 익명 로그인부터 켠 뒤 다시 확인하세요');
}

// 4) 계정 저장(saves) 규칙 — 다른 기기에서 이어서 하려면 필요하다
console.log('  — 계정 저장(saves)');
if (idToken) {
  const me = myUid;
  const write = await req(`${REST}/saves/${me}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { v: { integerValue: 1 } } }),
  });
  if (write.status === 200) {
    console.log('  ✓ 내 저장을 쓸 수 있음');
    await req(`${REST}/saves/${me}`, { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } });
  } else if (write.status === 403) {
    console.log('  ❌ 거부됨 — saves 규칙이 아직 배포되지 않았습니다');
    problems.push('firestore.rules 배포: firebase deploy --only firestore:rules');
  } else {
    console.log(`  ⚠️ 예상 밖 응답 ${write.status}: ${JSON.stringify(write.body).slice(0, 160)}`);
  }
} else {
  console.log('  ⚠️ 판정 불가 — 익명 로그인부터 켠 뒤 다시 확인하세요');
}

console.log('\n────────────────');
if (functionsDeployed) {
  console.log('모드: functions (서버 권위) — Cloud Functions가 심판을 봅니다');
} else {
  console.log('모드: firestore (클라이언트 직결) — 위 두 가지만 갖추면 온라인 대전이 됩니다');
}
if (!problems.length) {
  console.log('✅ 온라인 대전 준비 완료');
} else {
  console.log('❗ 남은 할 일:');
  for (const p of [...new Set(problems)]) console.log('   · ' + p);
  process.exitCode = 1;
}
