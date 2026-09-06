# AI 에이전트 개발 지침 및 빠른 컨텍스트 (AGENTS.md)

이 문서는 본 저장소(`trackingPrice`)에서 작업하는 모든 AI 에이전트를 위한 핵심 규칙과 컨텍스트입니다.

## 1. 핵심 아키텍처 요약
* **프론트엔드**: Vanilla HTML, CSS, JavaScript (Next.js/React/Tailwind 사용하지 않음)
* **데이터베이스**: Supabase REST API (`products`, `prices` 테이블)
* **단위가격 파서**: `js/app.js`의 `parseCapacity`, `calculateUnitPrice`
* **스크래퍼**:
  - 일일 배치: `.github/workflows/daily-scraper.yml` (매일 KST 09:00, `scraper/main.py`)
  - 단일 상품 즉시 등록: `node scraper/track_product.js <URL>` 또는 `python scraper/main.py <URL>`
  - 로컬 서버: `server.js` (`/api/scrape` 실시간 조회 제공)

## 2. 올리브영 스크래핑 주의사항 (필독)
1. **모바일 상세 URL 사용**: `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=...` (NetFUNNEL 대기열 없음, Next.js hydration JSON 포함)
2. **Node `fetch` 금지**: Node.js 내장 fetch는 TLS 지문 감지로 403 차단됨. 반드시 `curl.exe` 또는 Python `requests` 사용.
3. **CORS 주의**: 브라우저 클라이언트에서 올리브영 직접 호출 불가. `server.js`의 `/api/scrape`를 경유하거나 터미널 스크립트 활용.
4. **Supabase 1,000건 제한**: DB 쿼리 시 반드시 `.range(from, from + 999)` 페이징 루프 사용.

## 3. 상세 문서 링크
전체 시스템 구조, 스키마, 기획세트 파싱 규칙, Gotchas는 [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md)를 참고하세요.
