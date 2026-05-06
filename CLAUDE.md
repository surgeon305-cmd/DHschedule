# 도희 · 효중 공유 캘린더

## 프로젝트 개요
두 사람이 실시간으로 공유하는 5월 캘린더 웹앱.
- **도희**: 승무원 (YP 항공편)
- **효중**: 공중보건의 (주문도 섬 근무)

## 파일 구조
```
index.html   — 전체 앱 (단일 파일, HTML + CSS + JS)
CLAUDE.md    — 이 파일
```

## 기술 스택
- **Frontend**: 순수 HTML/CSS/JS (프레임워크 없음)
- **DB**: Supabase Realtime Database
- **Hosting**: GitHub Pages (`https://surgeon305-cmd.github.io/DHschedule`)

## Supabase 설정
- **URL**: `https://iqnrpyzsylsrvzmrcmti.supabase.co`
- **Table**: `calendar_may2026`
- **Schema**:
  ```sql
  day          integer primary key
  crew_type    text   -- flight | rest | off | rdo | stb | sth
  crew_flight  text   -- 항공편 번호 (예: YP801)
  crew_note    text   -- 시간 메모 (예: 0735~1845)
  doc_status   text   -- on | off | unknown
  ```

## 비밀번호
- `index.html` 내 `const PASSPHRASE = '...'` 값으로 관리
- 변경 시 이 값만 수정 후 commit

## 승무원 코드 설명
| 코드 | 의미 |
|------|------|
| flight | 항공편 근무 |
| rest | REST (비행 중 해외 체류) |
| off | OFF (휴무) |
| rdo | RDO (요청 휴무) |
| stb | STB — 공항 대기 (1430~1730) |
| sth | STH — 자택 대기 |

## 수정 방법
1. `index.html` 수정
2. `git add index.html && git commit -m "메시지" && git push`
3. GitHub Pages가 자동 배포 (1~2분 소요)

## 자주 하는 수정
- **비밀번호 변경**: `const PASSPHRASE = 'xxx'` 수정
- **효중 일정 패턴 자동 입력**: `CREW_DEFAULT` 아래에 `DOC_DEFAULT` 객체 추가
- **다음 달 캘린더 추가**: Supabase에 새 테이블 생성 + HTML 복사 후 날짜 수정
