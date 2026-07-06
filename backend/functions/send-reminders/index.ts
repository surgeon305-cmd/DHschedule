// ============================================================
//  send-reminders — Supabase Edge Function (Deno)
//  pg_cron 이 15분마다 호출 → 사용자가 개별로 켠 일정(notification_subs) 중
//  발송 시점이 된 것을 Web Push 로 보낸다.  (opt-in 모델: 켠 것만 발송)
//
//  Secrets: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_CONTACT(선택)
//  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 자동 주입.
//  발송 시점 판정은 KST(UTC+9) 기준.
// ============================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const CONTACT       = Deno.env.get('VAPID_CONTACT') || 'mailto:surgeon305@gmail.com';
webpush.setVapidDetails(CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);

const main = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const jumun = createClient(
  'https://qwudsfmedjunkuqkgrpv.supabase.co',
  'sb_publishable_zB6omtQKHnMLVvWDd91LOg_CzbJKlya',
);

const pad = (n: number) => String(n).padStart(2, '0');
function ymd(dt: Date) { return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`; }
function kstWallToEpoch(y: number, m: number, d: number, hh: number, mm: number) {
  return Date.UTC(y, m - 1, d, hh, mm) - 9 * 3600 * 1000;
}
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
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });

const TITLE: Record<string, string> = {
  island_handover: '🔄 섬 교대날',
  together:        '✦ 함께 있는 날',
  custom_event:    '● 일정 알림',
};

Deno.serve(async () => {
  const nowEpoch = Date.now();
  const nowKst = new Date(nowEpoch + 9 * 3600 * 1000);
  const fromKst = new Date(nowKst); fromKst.setUTCHours(0, 0, 0, 0);
  const toKst = new Date(fromKst); toKst.setUTCDate(toKst.getUTCDate() + 3);
  const from = ymd(fromKst), to = ymd(toKst);

  // 켠 일정 + 시점설정 + 발송로그
  const [{ data: subs }, { data: prefs }, { data: sent }] = await Promise.all([
    main.from('notification_subs').select('*').gte('date', from).lte('date', to),
    main.from('notification_prefs').select('*'),
    main.from('notifications_sent').select('device_id,date,item_key').gte('date', from).lte('date', to),
  ]);
  if (!subs || !subs.length) return json({ ok: true, sent: 0 });

  // 원본 데이터(현재 상태 재검증용) + 푸시 구독
  const [{ data: evRows }, { data: jRows }, { data: pushRows }] = await Promise.all([
    main.from('calendar_events').select('date,crew_type,custom_title').gte('date', from).lte('date', to),
    jumun.from('schedule').select('date,worker,is_handover').gte('date', from).lte('date', to),
    main.from('push_subscriptions').select('*'),
  ]);
  const ev: Record<string, any> = {}; (evRows || []).forEach(r => ev[r.date] = r);
  const jm: Record<string, any> = {}; (jRows  || []).forEach(r => jm[r.date] = r);
  const pushBy: Record<string, any> = {}; (pushRows || []).forEach(s => pushBy[s.device_id] = s);
  const prefBy: Record<string, any> = {}; (prefs || []).forEach(p => prefBy[`${p.device_id}|${p.category}`] = p);
  const sentSet = new Set((sent || []).map(s => `${s.device_id}|${s.date}|${s.item_key}`));

  // 항목이 현재도 유효한지 확인하고 표시 문구 반환 (사라졌으면 null → skip)
  function itemDetail(date: string, itemKey: string): string | null {
    const e = ev[date], j = jm[date];
    if (itemKey === 'island_handover') return j?.is_handover ? '효중 섬 교대날' : null;
    if (itemKey === 'together') {
      const isTog = e && ['off', 'rdo'].includes(e.crew_type) && j && j.worker !== '효중';
      return isTog ? '함께 있는 날' : null;
    }
    if (itemKey.startsWith('custom:')) {
      const idx = parseInt(itemKey.slice(7));
      const c = parseCustomEvents(e?.custom_title || '')[idx];
      return c ? `${c.owner} ${c.title}` : null;
    }
    return null;
  }

  let sentCount = 0;
  const jobs: Promise<void>[] = [];

  for (const sub of subs) {
    const push = pushBy[sub.device_id];
    if (!push) continue;                                  // 구독(엔드포인트) 없는 기기
    const detail = itemDetail(sub.date, sub.item_key);
    if (!detail) continue;                                // 일정이 바뀌었거나 삭제됨
    const pref = prefBy[`${sub.device_id}|${sub.category}`] || { offset_days: 1, at_time: '21:00' };
    const [hh, mm] = (pref.at_time || '21:00').split(':').map(Number);
    const s = shiftDate(sub.date, pref.offset_days ?? 1);
    const trig = kstWallToEpoch(s.y, s.m, s.d, hh || 0, mm || 0);
    if (nowEpoch < trig || nowEpoch - trig > 24 * 3600 * 1000) continue;  // 아직 이르거나 24h 초과
    const dedup = `${sub.device_id}|${sub.date}|${sub.item_key}`;
    if (sentSet.has(dedup)) continue;
    sentSet.add(dedup);

    const payload = JSON.stringify({
      title: TITLE[sub.category] || '캘린더 알림',
      body:  `${sub.date.slice(5).replace('-', '/')} · ${detail}`,
      url:   '/DHschedule/',
      tag:   `${sub.item_key}-${sub.date}`,
    });
    jobs.push((async () => {
      try {
        await webpush.sendNotification(
          { endpoint: push.endpoint, keys: { p256dh: push.p256dh, auth: push.auth } },
          payload,
        );
        await main.from('notifications_sent').insert({ device_id: sub.device_id, date: sub.date, item_key: sub.item_key });
        sentCount++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 410 || code === 404) {
          await main.from('push_subscriptions').delete().eq('device_id', sub.device_id);
        } else {
          console.error('push 실패', sub.device_id, code, err?.body || err?.message);
        }
      }
    })());
  }

  await Promise.all(jobs);
  return json({ ok: true, sent: sentCount });
});
