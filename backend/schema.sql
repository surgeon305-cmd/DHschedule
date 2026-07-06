-- ============================================================
--  알림(Web Push) 스키마 — DH 캘린더 메인 Supabase 프로젝트에 실행
--  Supabase 대시보드 → SQL Editor → 붙여넣기 → Run
-- ============================================================

-- 기기별 푸시 구독 (기기마다 1행, 덮어쓰기)
create table if not exists push_subscriptions (
  device_id  text primary key,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz default now()
);

-- 기기별 · 카테고리별 알림 설정 (서로 독립된 행 → 충돌 없음)
--   category: island_handover | together | custom_event
--   offset_days: 0=당일, 1=전날, 2=이틀 전
--   at_time: 'HH:MM' (KST 기준)
create table if not exists notification_prefs (
  device_id   text not null,
  category    text not null,
  enabled     boolean default true,
  offset_days int     default 1,
  at_time     text    default '21:00',
  updated_at  timestamptz default now(),
  primary key (device_id, category)
);

-- 중복 발송 방지 로그 (서버만 기록)
create table if not exists notifications_sent (
  device_id text not null,
  date      text not null,
  category  text not null,
  sent_at   timestamptz default now(),
  primary key (device_id, date, category)
);

-- ── RLS ──
-- 앱은 publishable(anon) 키로 접속 → 익명 접근 허용 (기존 calendar_events 와 동일한 신뢰 모델).
-- notifications_sent 는 서버(service_role)만 쓰므로 익명 정책을 만들지 않는다(= 익명 접근 불가).
alter table push_subscriptions  enable row level security;
alter table notification_prefs  enable row level security;
alter table notifications_sent  enable row level security;

drop policy if exists "anon all push_subscriptions" on push_subscriptions;
drop policy if exists "anon all notification_prefs" on notification_prefs;

create policy "anon all push_subscriptions" on push_subscriptions
  for all to anon using (true) with check (true);
create policy "anon all notification_prefs" on notification_prefs
  for all to anon using (true) with check (true);
