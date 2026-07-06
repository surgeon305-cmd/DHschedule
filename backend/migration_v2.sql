-- ============================================================
--  마이그레이션 v2 — opt-in(개별 일정 구독) 모델로 전환
--  이미 예전 schema.sql 을 실행한 프로젝트에서 이 파일만 추가 실행.
--  SQL Editor 에 붙여넣고 Run.
-- ============================================================

-- 1) 개별 일정 구독 테이블 (신규)
create table if not exists notification_subs (
  device_id  text not null,
  date       text not null,
  item_key   text not null,
  category   text not null,
  created_at timestamptz default now(),
  primary key (device_id, date, item_key)
);
alter table notification_subs enable row level security;
drop policy if exists "anon all notification_subs" on notification_subs;
create policy "anon all notification_subs" on notification_subs
  for all to anon using (true) with check (true);

-- 2) 발송 로그를 item_key 단위로 재생성 (예전엔 category 단위였음)
drop table if exists notifications_sent;
create table notifications_sent (
  device_id text not null,
  date      text not null,
  item_key  text not null,
  sent_at   timestamptz default now(),
  primary key (device_id, date, item_key)
);
alter table notifications_sent enable row level security;
-- 서버(service_role)만 쓰므로 익명 정책 없음
