-- ============================================================
--  알림(Web Push) 스키마 — DH 캘린더 메인 Supabase 프로젝트
--  (opt-in 모델: 사용자가 개별로 켠 일정만 알림)
--  ※ 새로 세팅하는 경우 이 파일 전체 실행.
--    이미 예전 스키마를 실행했다면 migration_v2.sql 만 실행.
-- ============================================================

-- 기기별 푸시 구독
create table if not exists push_subscriptions (
  device_id  text primary key,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz default now()
);

-- 기기별 · 카테고리별 알림 "시점" 설정 (몇 시에 보낼지)
--   category: island_handover | together | custom_event
--   offset_days: 0=당일, 1=전날, 2=이틀 전 / at_time: 'HH:MM' (KST)
create table if not exists notification_prefs (
  device_id   text not null,
  category    text not null,
  enabled     boolean default true,   -- (opt-in 모델에선 미사용, 호환 위해 유지)
  offset_days int     default 1,
  at_time     text    default '21:00',
  updated_at  timestamptz default now(),
  primary key (device_id, category)
);

-- 개별 일정 구독 (여기 행이 있으면 = 그 일정 알림 켜짐)
--   item_key: 'island_handover' | 'together' | 'custom:<인덱스>'
create table if not exists notification_subs (
  device_id  text not null,
  date       text not null,
  item_key   text not null,
  category   text not null,
  created_at timestamptz default now(),
  primary key (device_id, date, item_key)
);

-- 중복 발송 방지 로그 (서버만 기록)
create table if not exists notifications_sent (
  device_id text not null,
  date      text not null,
  item_key  text not null,
  sent_at   timestamptz default now(),
  primary key (device_id, date, item_key)
);

-- ── RLS ── 앱은 publishable(anon) 키로 접속 → 익명 접근 허용 (기존 테이블과 동일 모델)
alter table push_subscriptions enable row level security;
alter table notification_prefs enable row level security;
alter table notification_subs  enable row level security;
alter table notifications_sent enable row level security;

drop policy if exists "anon all push_subscriptions" on push_subscriptions;
drop policy if exists "anon all notification_prefs" on notification_prefs;
drop policy if exists "anon all notification_subs"  on notification_subs;
drop policy if exists "anon all notifications_sent" on notifications_sent;

create policy "anon all push_subscriptions" on push_subscriptions for all to anon using (true) with check (true);
create policy "anon all notification_prefs" on notification_prefs for all to anon using (true) with check (true);
create policy "anon all notification_subs"  on notification_subs  for all to anon using (true) with check (true);
-- Edge Function 이 (새 키 형식에서) anon 권한으로 도는 경우가 있어, 중복방지 로그도 anon 쓰기 허용.
create policy "anon all notifications_sent" on notifications_sent for all to anon using (true) with check (true);
