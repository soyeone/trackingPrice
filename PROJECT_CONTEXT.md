# 📋 Olive Young Price Tracker - Project Context & Developer Guide

> **이 문서는 본 프로젝트의 아키텍처, 데이터베이스 스키마, 핵심 로직, 스크래핑 제약 사항 및 개발 노하우를 압축 정리한 가이드입니다.**  
> 새로운 개발 세션이나 AI 에이전트가 투입되었을 때 불필요한 파일 탐색과 토큰 낭비 없이 프로젝트를 즉시 파악하고 기능을 이어 개발할 수 있도록 구성되었습니다.

---

## 1. 프로젝트 개요 (Overview)

* **목적**: CJ 올리브영(Olive Young)의 주요 12개 카테고리 실시간 랭킹 상품(각 100위, 총 1,000+개) 및 사용자가 직접 등록한 상품의 가격을 매일 추적하여, **일자별 가격 변동 추이**, **역대 최저가/최고가 분석**, 그리고 **정량적 단위가격(10ml당, 10g당, 개당 가격) 기반 가성비 비교**를 제공하는 웹 애플리케이션입니다.
* **핵심 저장소**: `e:\01_PRJ\trackingPrice`
* **원격 Git**: `https://github.com/soyeone/trackingPrice.git` (기본 브랜치: `main`)

---

## 2. 기술 스택 & 시스템 아키텍처 (Tech Stack)

```
[ 올리브영 모바일/웹 ]
        │  (매일 09:00 KST GitHub Actions 또는 로컬 CLI / API)
        ▼
[ Python / Node 스크래퍼 ]  ───►  [ Supabase (PostgreSQL) ]
  (main.py / track_product.js)         (products, prices 테이블)
                                              ▲
                                              │ (REST API 페이징 쿼리)
                                              ▼
                                   [ Frontend (Vanilla JS) ]
                                   (index.html / register.html)
                                   - Chart.js 가격 추이 그래프
                                   - 단위가격 계산 및 가성비 정렬
                                   - 카테고리 묶어보기 / 그리드 뷰
```

* **Frontend**: HTML5, Vanilla CSS3 (Custom Design System, CSS Variables), Vanilla JavaScript (ES6+)
  - 프레임워크 없는 순수 바닐라 웹 앱으로 로딩 속도 최적화
  - 차트 라이브러리: **Chart.js** (CDN)
  - DB 연동: `@supabase/supabase-js` v2 (CDN)
* **Backend / Database**: **Supabase** (PostgreSQL Database + REST API)
  - `SUPABASE_URL`: `https://lgdrqxsgmfighunegehv.supabase.co`
  - `SUPABASE_KEY`: Anon Public Key 사용
* **Automation (배치 스크래퍼)**:
  - **GitHub Actions**: `.github/workflows/daily-scraper.yml` (매일 아침 09:00 KST / UTC 00:00 자동 실행)
  - **Python Scraper**: `scraper/main.py` (`requests`, `beautifulsoup4`, `supabase-py`)
* **로컬 서버 & 실시간 조회**:
  - `server.js`: 정적 웹 서버 + `/api/scrape` 엔드포인트 (`curl.exe` 기반 모바일 올리브영 실시간 파싱)

---

## 3. 데이터베이스 스키마 (Database Schema)

### 3.1. `products` 테이블 (상품 메타데이터)
| 컬럼명 | 타입 | 설명 | 비고 |
| :--- | :--- | :--- | :--- |
| `id` | uuid / bigint | 내부 식별자 | 자동 생성 |
| `goods_no` | text | 올리브영 상품 번호 (예: `A000000262602`) | **UNIQUE**, Primary Key 역할 |
| `name` | text | 상품명 (정량 규격 포함) | 예: `... 세럼 50ml 더블기획` |
| `url` | text | 올리브영 상품 상세 URL | 카테고리/랭킹 파라미터 포함 |
| `category` | text | 카테고리명 | 스킨케어, 마스크팩 등 |
| `rank` | integer | 카테고리 내 랭킹 (1~100) | 없을 경우 null |
| `is_custom` | boolean | 사용자 직접 등록 상품 여부 | 기본값: false |

### 3.2. `prices` 테이블 (일자별 가격 기록)
| 컬럼명 | 타입 | 설명 | 비고 |
| :--- | :--- | :--- | :--- |
| `id` | uuid / bigint | 고유 ID | 자동 생성 |
| `goods_no` | text | 상품 번호 (Foreign Key) | `products.goods_no` 참조 |
| `price` | integer | 수집된 당일 최종 판매 가격 (원) | 할인가 우선, 정상가 |
| `date` | date | 수집 일자 (`YYYY-MM-DD`) | 하루 1건 기록 |

> **중요 제약 조건**: `(goods_no, date)` 복합 유니크 제약이 걸려 있으므로, 하루에 여러 번 수집되더라도 `upsert(..., on_conflict='goods_no,date')`로 중복 없이 당일 최신 가격으로 갱신됩니다.

---

## 4. 디렉터리 및 주요 파일 구조 (Project Map)

```
trackingPrice/
├── .github/
│   └── workflows/
│       └── daily-scraper.yml      # GitHub Actions 일일 자동 스크래핑 (매일 KST 09:00)
├── css/
│   └── style.css                 # 올리브영 그린 테마, 모바일 반응형, 뱃지/카드/차트 디자인
├── js/
│   └── app.js                    # 프론트엔드 메인 로직 (대시보드 + 제품 등록 + 단위가격 파서)
├── scraper/
│   ├── main.py                   # Python 전체/단일 스크래퍼 (GitHub Actions 및 로컬 CLI용)
│   ├── track_product.js          # Node.js 단일 상품 실시간 스크래핑 & Supabase upsert 스크립트
│   ├── seed_ranking.js           # 12개 카테고리 랭킹 수집용 Node 스크립트
│   └── requirements.txt          # Python 의존성 목록
├── index.html                    # 메인 가격 트래커 대시보드
├── register.html                 # 새 제품 즉시 등록 & 실시간 트래킹 페이지
├── server.js                     # 로컬 웹 서버 및 실시간 올리브영 조회 API (/api/scrape)
├── package.json                  # 프로젝트 실행 스크립트 (npm start, npm run track)
├── PROJECT_CONTEXT.md            # [본 문서] 빠른 온보딩 및 개발 컨텍스트 가이드
└── README.md                     # 프로젝트 안내 문서
```

---

## 5. 핵심 비즈니스 로직 및 구현 상세

### 5.1. 정량 규격 파서 & 단위가격 계산기 (`js/app.js`)
제품명 텍스트에서 용량/수량을 인식하여 다른 제품과 동일한 잣대로 비교할 수 있도록 단위가격을 계산합니다.
* **함수**: `parseCapacity(name)`, `calculateUnitPrice(price, capInfo)`
* **지원 단위 및 기준 규격**:
  - 액체/에센스/세럼 (`ml`, `L`): **`10ml당 가격`** 산출 (1L = 1,000ml 환산)
  - 크림/밤/파우더 (`g`, `kg`): **`10g당 가격`** 산출 (1kg = 1,000g 환산)
  - 패드/시트마스크 (`매`): **`1매당 가격`** 산출
  - 정제/영양제 (`정`, `캡슐`): **`1정당 가격`** 산출
  - 스틱/가루포 (`포`): **`1포당 가격`** 산출
  - 소품/치실/면도날 (`개`, `입`): **`개당 가격`** 산출
* **기획세트 특수 처리**:
  - 합산형: `50+50ml`, `100+100매` ➔ 100ml, 200매로 자동 합산
  - 곱산형: `30ml*2`, `100매x2개입` ➔ 곱산 합산
  - 묶음형: `1+1`, `더블기획`, `듀오기획` 키워드 감지 시 단일 용량의 2배 자동 적용
  - 리필형: `50ml (+50ml 리필)` 본품+리필 자동 합산
* **한글 오인식 방지 (중요)**:
  - `포밍 클렌저`의 "포", `주름개선`의 "개", `정품 증정`의 "정" 등 한국어 일반 단어가 단위 수량으로 잘못 매칭되지 않도록 정밀 음운 경계 처리(`(?![가-힣a-zA-Z0-9])`)가 되어 있습니다.

### 5.2. 대시보드 다중 뷰 & 정렬 로직 (`js/app.js`)
* **카테고리별 묶어보기 모드 (`grouped`)**:
  - 12개 카테고리별 상위 8개 상품 카드 노출 + 하단 'TOP 100 전체보기' 확장 버튼
* **전체 그리드 모드 (`flat`)**:
  - 선택된 카테고리(또는 전체) 상품을 단일 그리드로 나열
* **정렬 모드 (`currentSortMode`)**:
  - `rank`: 👑 카테고리 랭킹순 (기본)
  - `unit_asc`: ⚡ **가성비순 (단위가격 낮은순)** ➔ 10ml당/개당 가격이 가장 저렴한 순으로 정렬 (단위정보 있는 상품 우선)
  - `price_asc`: 📉 가격 낮은순
  - `price_desc`: 📈 가격 높은순

### 5.3. 새 제품 등록 및 즉시 트래킹 (`register.html`, `js/app.js`, `server.js`)
* 사용자가 올리브영 상품 URL을 입력하면, 다음날 아침까지 대기하지 않고 **등록 즉시 올리브영 실시간 정보를 스크래핑**하여 당일 가격으로 트래킹을 시작합니다.
* `server.js` 실행 환경에서는 `/api/scrape?goodsNo=...`를 통해 제품명, 현재 가격, 단위가격을 자동으로 채워 넣고 원클릭 등록합니다.
* 등록 시 `products` 테이블(상품 메타데이터)과 `prices` 테이블(오늘 일자 가격 기록)이 동시에 생성되므로, **대시보드에서 즉시 당일 가격 및 차트 확인이 가능**합니다.

---

## 6. 올리브영 스크래핑 핵심 노하우 & 기술적 제약 (Gotchas)

1. **해외 데이터센터 IP 차단 (Geoblocking & WAF)**:
   - 올리브영 국내 사이트는 Cloudflare/Akamai 방화벽으로 **해외 IP 및 클라우드 호스팅/데이터센터(Azure/GitHub Actions, AWS 등) IP 대역을 100% 403 Forbidden으로 원천 차단**합니다.
   - 따라서 GitHub Actions 무료 러너에서 실행 시 모든 요청이 403으로 막히며, 반드시 **국내 로컬 IP 환경(`scraper/daily_crawler.js`)**에서 실행해야 합니다.
2. **PC 랭킹 수집 시 세션 쿠키 필수 (`initSessionCookies`)**:
   - 올리브영 PC 페이지(`getBestList.do`)는 쿠키 없이 직접 호출 시 Cloudflare 봇 챌린지(`cf-mitigated: challenge`, 잠시만 기다려 주세요)가 발생합니다.
   - 메인 페이지(`https://www.oliveyoung.co.kr/`)를 먼저 거쳐 세션 쿠키(`cookie jar`)를 획득한 후 `getBestList.do`를 호출하면 Cloudflare 챌린지를 완벽하게 통과하여 100개 상품을 정상 수집할 수 있습니다.
3. **데스크톱 vs 모바일 상세 페이지**:
   - 올리브영 PC 상세 페이지는 넷퍼넬 대기열이 걸릴 수 있습니다.
   - 반면 **모바일 상세 페이지**(`https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=...`)는 대기열이 없으며, Next.js Hydration 데이터(`\"goodsName\"`, `\"finalPrice\"`, `\"salePrice\"`)가 JSON 문자열 형태로 안전하게 포함되어 있어 랭킹 밖 상품 가격 갱신에 최적입니다.
4. **TLS 지문 (JA3 Fingerprint) 및 Node.js Fetch 이슈**:
   - Node.js 22 내장 `fetch()`로 올리브영 모바일 페이지를 직접 호출하면 Akamai/Cloudflare 봇 감지에 걸려 `403 Forbidden`이 반환됩니다.
   - 반면 **`curl.exe` (Git mingw64 포함 버전)**는 봇 감지를 통과하므로 `child_process.spawn('curl.exe', ...)` 방식으로 실시간 스크래핑을 수행합니다.
5. **브라우저 CORS 제한**:
   - 브라우저(`register.html`)에서 올리브영 직접 호출은 CORS로 차단되므로, `npm start` 로컬 프록시 API(`/api/scrape`)를 경유합니다.
6. **Supabase 1,000건 기본 상한 극복**:
   - PostgREST 기본 1,000건 제한을 피하기 위해 `.range(from, from + 999)` 페이징 루프로 전건(1,200+건)을 로드/저장합니다.
7. **PC 부팅 시 당일 중복 수집 방지 (Idempotency)**:
   - 사용자 PC가 하루에 여러 번 켜질 수 있으므로, `scraper/last_run.json`에 오늘 날짜(`YYYY-MM-DD`) 성공 기록이 남아 있으면 스크래퍼가 0.1초 만에 자동으로 조용히 종료됩니다. (강제 재수집은 `--force` 플래그 사용)

---

## 7. 주요 실행 명령어 (Command Cheat Sheet)

| 용도 | 명령어 / 파일 | 설명 |
| :--- | :--- | :--- |
| **부팅 시 자동 실행 등록 (원클릭)** | `setup_autostart.bat` | Windows 시작프로그램에 무간섭 백그라운드 스크래퍼 등록 (더블클릭) |
| **부팅 시 자동 실행 해제** | `remove_autostart.bat` | Windows 시작프로그램에서 자동 실행 제거 (더블클릭) |
| **일일 스크래퍼 수동 실행 (Node)** | `npm run crawl` (또는 `run_daily_scraper.bat`) | 당일 미수집 시 전체 랭킹 및 가격 수집 (중복 시 건너뜀) |
| **일일 스크래퍼 강제 재실행** | `npm run crawl:force` | 오늘 이미 수집했더라도 강제로 다시 전건 수집 |
| **로컬 웹 서버 구동** | `npm start` (또는 `node server.js`) | http://localhost:3000 대시보드 및 실시간 스크래핑 등록 서버 구동 |
| **단일 상품 즉시 트래킹 (Node)** | `npm run track <올리브영URL 또는 goodsNo>` | 터미널에서 즉시 올리브영 파싱 후 Supabase 등록 및 당일 가격 기록 |

---

## 8. 향후 추가 고려 가능한 작업 (Backlog)

* **카테고리별/제형별 가성비 랭킹 전용 탭**: (예: 세럼 중 10ml당 최저가 TOP 10, 수분크림 중 10g당 최저가 TOP 10 등)
* **목표 가격 도달 알림 기능**: 이메일 또는 웹훅(Discord, Telegram) 연동
* **옵션별 가격 추적**: 단일 상품 페이지 내 세부 옵션(색상/용량 호수)별 가격 구분 추적
