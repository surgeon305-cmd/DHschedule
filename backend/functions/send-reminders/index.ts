// ============================================================
//  send-reminders — Supabase Edge Function (Deno)
//  pg_cron 이 15분마다 호출 → 다가온 일정 중 발송 시점이 된 알림을 Web Push 로 보낸다.
//
//  필요한 비밀값(Supabase 대시보드 → Edge Functions → send-reminders → Secrets):
//    VAPID_PUBLIC_KEY   = BNtGad1oWOBoG...(index.html 과 동일한 공개키)
//    VAPID_PRIVATE_KEY  = (VAPID 개인키 — 절대 공개 금지)
//    VAPID_CONTACT      = mailto:surgeon305@gmail.com  (선택)
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Edge Function 에 자동 주입됨.
// ============================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const CONTACT       = Deno.env.get('VAPID_CONTACT') || 'mailto:surgeon305@gmail.com';
webpush.setVapidDetails(CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

// 메인 DB (service_role → RLS 우회)
const main = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
// 주문도 DB (읽기 전용, 공개 키 — index.html 과 동일)
const jumun = createClient(
  'https://qwudsfmedjunkuqkgrpv.supabase.co',
  'sb_publishable_zB6omtQKHnMLVvWDd91LOg_CzbJKlya',
);

// ── 날짜 유틸 (KST = UTC+9 고정, DST 없음) ──
const pad = (n: number) => String(n).padStart(2, '0');
function ymd(dt: Date) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
// KST 벽시계 → epoch(ms)
function kstWallToEpoch(y: number, m: number, d: number, hh: number, mm: number) {
  return Date.UTC(y, m - 1, d, hh, mm) - 9 * 3600 * 1000;
}
// dateStr 에서 minusDays 뺀 {y,m,d}
function shiftDate(dateStr: string, minusDays: number) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - minusDays);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function parseCustomEvents(title: string): { title: string; owner: string }[] {
  if (!title) return [];
  try { const p = JSON.parse(title); if (Array.isArray(p)) return p; } catch (_) {}
  return [{ title, owner: '함께' }];
}

Deno.serve(async () => {
  const nowEpoch = Date.now();
  const nowKst = new Date(nowEpoch + 9 * 3600 * 1000);
  // 조회 창: 오늘 ~ 오늘+3일 (KST)
  const fromKst = new Date(nowKst); fromKst.setUTCHours(0, 0, 0, 0);
  const toKst = new Date(fromKst); toKst.setUTCDate(toKst.getUTCDate() + 3);
  const from = ymd(fromKst), to = ymd(toKst);

  // 1) 이벤트 로드 → 날짜별 카테고리 판정 자료 구성
  const [{ data: evRows }, { data: jRows }] = await Promise.all([
    main.from('calendar_events').select('date,crew_type,custom_title').gte('date', from).lte('date', to),
    jumun.from('schedule').select('date,worker,is_handover').gte('date', from).lte('date', to),
  ]);
  const ev: Record<string, any> = {}; (evRows || []).forEach(r => ev[r.date] = r);
  const jm: Record<string, any> = {}; (jRows  || []).forEach(r => jm[r.date] = r);

  // 날짜 → { 카테고리: 표시할 상세 }  (해당 카테고리가 그날 성립하면 포함)
  function dayCategories(date: string) {
    const out: Record<string, string> = {};
    const e = ev[date], j = jm[date];
    // 섬 교대날
    if (j?.is_handover) out.island_handover = '효중 섬 교대날';
    // 커스텀 이벤트
    const customs = parseCustomEvents(e?.custom_title || '');
    const together = customs.filter(c => c.owner === '함께');
    const personal = customs.filter(c => c.owner === '도희' || c.owner === '효중');
    // 함께 있는 날: 도희 off/rdo + 효중 휴무(worker!=='효중', 단 schedule 행 존재)
    const isTogether = e && ['off', 'rdo'].includes(e.crew_type) && j && j.worker !== '효중';
    if (isTogether || together.length) {
      out.together = together.length ? together.map(c => c.title).join(', ') : '함께 있는 날';
    }
    if (personal.length) out.custom_event = personal.map(c => `${c.owner} ${c.title}`).join(', ');
    return out;
  }

  const TITLE: Record<string, string> = {
    island_handover: '🔄 섬 교대날',
    together:        '✦ 함께 있는 날',
    custom_event:    '● 일정 알림',
  };

  // 2) 구독 + 설정 로드
  const [{ data: subs }, { data: prefs }, { data: sent }] = await Promise.all([
    main.from('push_subscriptions').select('*'),
    main.from('notification_prefs').select('*').eq('enabled', true),
    main.from('notifications_sent').select('device_id,date,category').gte('date', from).lte('date', to),
  ]);
  const subByDevice: Record<string, any> = {}; (subs || []).forEach(s => subByDevice[s.device_id] = s);
  const sentSet = new Set((sent || []).map(s => `${s.device_id}|${s.date}|${s.category}`));

  // 날짜 목록 (from~to)
  const dates: string[] = [];
  for (let dt = new Date(fromKst); ymd(dt) <= to; dt.setUTCDate(dt.getUTCDate() + 1)) dates.push(ymd(dt));

  let sentCount = 0;
  const jobs: Promise<void>[] = [];

  for (const p of (prefs || [])) {
    const sub = subByDevice[p.device_id];
    if (!sub) continue; // 구독 없는 기기 skip
    for (const date of dates) {
      const cats = dayCategories(date);
      const detail = cats[p.category];
      if (!detail) continue;
      // 발송 시점 = (date - offset_days) 의 at_time (KST)
      const [hh, mm] = (p.at_time || '21:00').split(':').map(Number);
      const s = shiftDate(date, p.offset_days ?? 1);
      const triggerEpoch = kstWallToEpoch(s.y, s.m, s.d, hh || 0, mm || 0);
      // 발송 시점이 지났고(now>=trigger), 24시간 이내(오래된 것 재발송 방지)
      if (nowEpoch < triggerEpoch || nowEpoch - triggerEpoch > 24 * 3600 * 1000) continue;
      const dedup = `${p.device_id}|${date}|${p.category}`;
      if (sentSet.has(dedup)) continue;
      sentSet.add(dedup);

      const payload = JSON.stringify({
        title: TITLE[p.category] || '캘린더 알림',
        body:  `${date.slice(5).replace('-', '/')} · ${detail}`,
        url:   '/DHschedule/',
        tag:   `${p.category}-${date}`,
      });
      jobs.push((async () => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          await main.from('notifications_sent').insert({ device_id: p.device_id, date, category: p.category });
          sentCount++;
        } catch (err: any) {
          const code = err?.statusCode;
          // 만료된 구독(410 Gone / 404) → 정리
          if (code === 410 || code === 404) {
            await main.from('push_subscriptions').delete().eq('device_id', p.device_id);
          } else {
            console.error('push 실패', p.device_id, code, err?.body || err?.message);
          }
        }
      })());
    }
  }

  await Promise.all(jobs);
  return new Response(JSON.stringify({ ok: true, sent: sentCount }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
