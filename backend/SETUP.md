# 알림(Web Push) 백엔드 설정 가이드

프론트엔드(1단계)는 이미 `index.html` / `service-worker.js`에 들어가 있습니다.
이 문서는 **2단계 — 실제 발송 백엔드**를 Supabase에 올리는 절차입니다.
전부 Supabase 대시보드(웹)에서 할 수 있습니다.

메인 프로젝트: `https://iqnrpyzsylsrvzmrcmti.supabase.co`

---

## VAPID 키 (이미 생성됨)

- **공개키** (index.html 에 이미 들어감, 공개 OK)
  `BNtGad1oWOBoGolvCe4tWDwSX03e8dgqQtcryOD_8NV_za0jgzWgyiekxp5OH1LTZjMpX4lGgY7T_Ba0ee0rpcs`
- **개인키** (⚠️ 절대 공개·커밋 금지 — Claude가 채팅으로 전달)
  → 아래 4단계에서 Secret 으로만 등록

> 키를 새로 만들려면: `node -e 'const c=require("crypto");const e=c.createECDH("prime256v1");e.generateKeys();const b=x=>x.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");console.log("PUB",b(e.getPublicKey()));console.log("PRIV",b(e.getPrivateKey()))'`
> (새로 만들면 index.html 의 `VAPID_PUBLIC_KEY` 도 같은 값으로 교체해야 함)

---

> **모델**: opt-in — 사용자가 각 날짜를 열어 일정 옆 🔔을 켠 것만 알림이 갑니다.
> 상단 🔔 탭은 종류별 "시점(몇 시)"만 정합니다.

## 1. 테이블 생성

- **처음 세팅**: 대시보드 → **SQL Editor** → `backend/schema.sql` 전체 붙여넣기 → **Run**
- **이미 예전 스키마를 실행했다면**: `backend/migration_v2.sql` 만 실행
  (notification_subs 추가 + notifications_sent 를 item_key 단위로 교체)

## 2. Edge Function 배포

**방법 A — 대시보드 (CLI 없이):**
대시보드 → **Edge Functions** → **Create a function** → 이름 `send-reminders`
→ `backend/functions/send-reminders/index.ts` 내용 붙여넣기 → **Deploy**

**방법 B — CLI:**
```bash
npm i -g supabase
supabase login
supabase link --project-ref iqnrpyzsylsrvzmrcmti
supabase functions deploy send-reminders
```

## 3. 비밀값(Secrets) 등록

대시보드 → **Edge Functions** → `send-reminders` → **Secrets** (또는 Settings → Edge Functions → Secrets):

| 이름 | 값 |
|------|-----|
| `VAPID_PUBLIC_KEY`  | `BNtGad1oWOBoG...rpcs` (위 공개키 전체) |
| `VAPID_PRIVATE_KEY` | (Claude가 준 개인키) |
| `VAPID_CONTACT`     | `mailto:surgeon305@gmail.com` |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 는 자동 주입되므로 넣지 않아도 됩니다.

## 4. 15분마다 자동 실행 (pg_cron)

대시보드 → **SQL Editor** 에서 아래 실행. `<ANON_KEY>` 는
Settings → API → `anon public` 키(= index.html 의 publishable 키)로 바꾸세요.

```sql
-- 확장 활성화 (한 번만)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 15분마다 send-reminders 호출
select cron.schedule(
  'send-reminders-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://iqnrpyzsylsrvzmrcmti.functions.supabase.co/send-reminders',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    )
  );
  $$
);
```

> 스케줄 확인: `select * from cron.job;`
> 삭제: `select cron.unschedule('send-reminders-15m');`

## 5. 테스트

1. 폰(또는 브라우저)에서 앱 열기 → 🔔 → **알림 켜기** (권한 허용)
2. 카테고리 하나 켜고, **시점을 "당일" + 지금 시각 몇 분 뒤**로 설정
3. 그 날짜에 해당 일정(예: 개인 추가 일정)이 있게 만들기
4. 함수 수동 호출로 즉시 확인:
   ```bash
   curl -X POST 'https://iqnrpyzsylsrvzmrcmti.functions.supabase.co/send-reminders' \
     -H 'Authorization: Bearer <ANON_KEY>'
   ```
   응답 `{"ok":true,"sent":N}` → N만큼 발송됨.

---

## 참고 / 주의

- **iOS**: 홈 화면에 추가한 PWA + iOS 16.4↑ 에서만 푸시가 옵니다. 사파리 탭에서는 안 옴.
- 발송 시점 판정은 **KST(UTC+9)** 기준.
- 중복 방지: `notifications_sent (device_id, date, category)` 로 하루·카테고리당 1회.
- 만료된 구독(410/404)은 발송 시 자동 삭제됨.
- 카테고리 분류:
  - `island_handover` = 주문도 schedule 의 `is_handover`
  - `together` = (도희 off/rdo + 효중 휴무) 겹치는 날 **또는** owner='함께' 추가 일정
  - `custom_event` = owner='도희'/'효중' 인 추가 일정
