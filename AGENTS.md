# AI 에이전트 개발 지침 및 빠른 컨텍스트 (AGENTS.md)

이 문서는 본 저장소(`trackingPrice`)에서 작업하는 모든 AI 에이전트를 위한 핵심 규칙과 컨텍스트입니다.

## 1. 핵심 아키텍처 요약
* **프론트엔드**: Vanilla HTML, CSS, JavaScript (Next.js/React/Tailwind 사용하지 않음)
* **데이터베이스**: Supabase REST API (`products`, `prices` 테이블)
* **단위가격 파서**: `js/app.js`의 `parseCapacity`, `calculateUnitPrice`
* **스크래퍼**:
* **스크래퍼**:
  - 일일 자동 수집: `scraper/daily_crawler.js` (Windows 부팅 시 자동 실행, 당일 중복 방지 `last_run.json` 내장)
  - 부팅 자동 실행 등록: `setup_autostart.bat` (해제: `remove_autostart.bat`)
  - 단일 상품 즉시 등록: `node scraper/track_product.js <URL>`
  - 로컬 서버: `server.js` (`/api/scrape` 실시간 조회 제공)
  - GitHub Actions: `.github/workflows/daily-scraper.yml` (올리브영의 해외 IP 차단으로 인해 수동 디버그용으로만 유지)

## 2. 올리브영 스크래핑 주의사항 (필독)
1. **해외 데이터센터 IP 차단 (Geoblocking)**: GitHub Actions(미국 Azure) 등 해외 IP는 올리브영 Cloudflare WAF에서 100% `403 Forbidden` 차단됨. 반드시 **국내 로컬 IP 환경(`daily_crawler.js`)**에서 실행해야 함.
2. **PC 랭킹 수집 시 세션 쿠키 필수**: `getBestList.do`는 쿠키 없이 직접 호출 시 Cloudflare 봇 챌린지 403이 발생함. 메인 페이지(`https://www.oliveyoung.co.kr/`)를 먼저 거쳐 세션 쿠키를 획득한 뒤 호출해야 정상 로드됨.
3. **모바일 상세 URL 사용**: `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=...` (NetFUNNEL 대기열 없음, Next.js hydration JSON 포함)
4. **Node `fetch` 금지**: Node.js 내장 fetch는 올리브영 TLS 지문 감지로 403 차단됨. 반드시 Git mingw64의 `curl.exe`를 spawn하여 호출.
5. **CORS 주의**: 브라우저 클라이언트에서 올리브영 직접 호출 불가. `server.js`의 `/api/scrape`를 경유하거나 터미널 스크립트 활용.
6. **Supabase 1,000건 제한**: DB 쿼리 시 반드시 `.range(from, from + 999)` 페이징 루프 사용.

## 3. 상세 문서 링크
전체 시스템 구조, 스키마, 기획세트 파싱 규칙, Gotchas는 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)를 참고하세요.
