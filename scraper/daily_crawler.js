/**
 * 올리브영 일일 가격 자동 스크래퍼 (Node.js)
 * - 세션 쿠키(Cookie Jar) 기반 Cloudflare 통과 및 12개 카테고리 랭킹 TOP 100 수집
 * - 순위 밖으로 밀려난 기존 상품 및 직접 등록 상품도 모바일 페이지로 가격 갱신
 * - 당일(오늘) 이미 수집 완료 시 중복 실행 방지 (부팅 시 반복 실행 방지)
 * - --force 플래그 지원 (node daily_crawler.js --force 로 강제 재수집 가능)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.env.PATH = `C:\\Program Files\\Git\\mingw64\\bin;${process.env.PATH}`;

const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

const STATE_FILE = path.join(__dirname, 'last_run.json');
const LOG_FILE = path.join(__dirname, 'scraper.log');
const COOKIE_FILE = path.join(__dirname, 'cookies.txt');

const CATEGORIES = [
  { catName: '스킨케어', catNo: '10000010001' },
  { catName: '마스크팩', catNo: '10000010009' },
  { catName: '클렌징', catNo: '10000010010' },
  { catName: '선케어', catNo: '10000010011' },
  { catName: '메이크업', catNo: '10000010002' },
  { catName: '더모 코스메틱', catNo: '10000010008' },
  { catName: '헤어케어', catNo: '10000010004' },
  { catName: '바디케어', catNo: '10000010003' },
  { catName: '향수/디퓨저', catNo: '10000010005' },
  { catName: '건강식품', catNo: '10000020001' },
  { catName: '구강용품', catNo: '10000020003' },
  { catName: '맨즈에딧', catNo: '10000010007' },
];

function log(msg) {
  const timestamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const line = `[${timestamp}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {}
}

function getTodayKst() {
  const now = new Date();
  const kstOffset = 9 * 60;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstDate = new Date(utc + (kstOffset * 60000));
  return kstDate.toISOString().split('T')[0];
}

// 0. 메인 페이지 방문을 통한 Cloudflare 브라우저 세션 쿠키 획득
function initSessionCookies() {
  return new Promise((resolve) => {
    const args = [
      '-s', '-L',
      '-c', COOKIE_FILE,
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9',
      'https://www.oliveyoung.co.kr/'
    ];
    try {
      const child = spawn('curl.exe', args);
      child.on('close', () => resolve(true));
      child.on('error', () => resolve(false));
    } catch (e) {
      resolve(false);
    }
  });
}

// 1. 카테고리별 PC 랭킹 100위 HTML 가져오기 (쿠키 세션 유지)
function fetchCategoryHtml(catNo, maxRetries = 2) {
  return new Promise(async (resolve) => {
    const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${catNo}&pageIdx=1&rowsPerPage=100`;
    const args = [
      '-s', '-L', '--compressed',
      '-b', COOKIE_FILE,
      '-c', COOKIE_FILE,
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      '-H', 'Referer: https://www.oliveyoung.co.kr/store/main/getBestList.do',
      url
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let chunks = [];
      const success = await new Promise((resAttempt) => {
        try {
          const child = spawn('curl.exe', args);
          child.stdout.on('data', chunk => { chunks.push(chunk); });
          child.on('error', () => resAttempt(false));
          child.on('close', code => {
            if (code === 0) {
              const text = Buffer.concat(chunks).toString('utf8');
              if (text.includes('prd_info')) {
                resAttempt(text);
                return;
              }
            }
            resAttempt(false);
          });
        } catch (e) {
          resAttempt(false);
        }
      });

      if (success) {
        return resolve(success);
      }

      // 실패 시 세션 재초기화 후 재시도
      await initSessionCookies();
      await new Promise(r => setTimeout(r, 1500));
    }

    resolve('');
  });
}

function parseProductsFromHtml(html, cat) {
  const items = [];
  const prdInfoBlocks = html.split(/<div class="prd_info\s*">/g);

  for (let i = 1; i < prdInfoBlocks.length; i++) {
    const block = prdInfoBlocks[i].split(/<\/div>\s*<\/li>/)[0];

    const goodsNoMatch = block.match(/data-ref-goodsNo="([A-Za-z0-9]+)"/i);
    if (!goodsNoMatch) continue;
    const goodsNo = goodsNoMatch[1];

    const rankMatch = block.match(/<span class="thumb_flag[^"]*">([0-9]+)<\/span>/i);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : i;

    let name = '';
    const nameMatch = block.match(/data-ref-goodsnm="([^"]+)"/i) || block.match(/<p class="tx_name">([^<]+)<\/p>/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }

    let price = 0;
    const priceMatch = block.match(/<span class="tx_cur"[^>]*>[\s\S]*?<span class="tx_num">([^<]+)<\/span>/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    }

    if (goodsNo && name && price > 0) {
      items.push({
        goods_no: goodsNo,
        name: name,
        price: price,
        rank: rank,
        category: cat.catName,
        cat_no: cat.catNo,
        url: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo}&dispCatNo=${cat.catNo}&catName=${encodeURIComponent(cat.catName)}&rank=${rank}`
      });
    }
  }

  return items;
}

// 2. 단일 상품 모바일 상세 페이지에서 가격 조회
function fetchSingleProductDetail(goodsNo) {
  return new Promise((resolve) => {
    const url = `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;
    const args = [
      '-s', '-L', '--compressed',
      '-A', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9',
      url
    ];

    try {
      const child = spawn('curl.exe', args);
      let chunks = [];
      child.stdout.on('data', c => chunks.push(c));
      child.on('close', code => {
        if (code !== 0) return resolve(null);
        const text = Buffer.concat(chunks).toString('utf8');

        const gnMatch = text.match(/goodsName(?:\\*)"\s*:\s*(?:\\*)"([^"\\]+)/);
        const fpMatch = text.match(/finalPrice(?:\\*)"\s*:\s*([0-9]+)/) || text.match(/salePrice(?:\\*)"\s*:\s*([0-9]+)/);

        let name = gnMatch ? gnMatch[1] : null;
        let price = fpMatch ? parseInt(fpMatch[1], 10) : null;
        resolve({ name, price });
      });
      child.on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// 3. Supabase DB 헬퍼 (페이징 전체 조회 및 일괄 저장)
async function fetchAllDbProducts() {
  const all = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=goods_no,name,url,is_custom`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Range': `${from}-${from + limit - 1}`
      }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < limit) break;
    from += limit;
  }

  return all;
}

async function batchUpsertProducts(products) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const CHUNK_SIZE = 100;
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE);
    await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=goods_no`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk)
    });
  }
}

async function batchUpsertPrices(prices, todayDate) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const CHUNK_SIZE = 100;
  for (let i = 0; i < prices.length; i += CHUNK_SIZE) {
    const chunk = prices.slice(i, i + CHUNK_SIZE).map(p => ({
      goods_no: p.goods_no,
      price: p.price,
      date: todayDate
    }));

    await fetch(`${SUPABASE_URL}/rest/v1/prices?on_conflict=goods_no,date`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk)
    });
  }
}

async function main() {
  const isForce = process.argv.includes('--force');
  const today = getTodayKst();

  log(`====================================================`);
  log(`올리브영 가격 자동 추적기 시작 (기준일: ${today})`);

  // [부팅 시 중복 방지] 오늘 이미 수집 완료했는지 확인
  if (!isForce) {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.last_run === today && state.status === 'success') {
          log(`[안내] 오늘(${today})자 가격 데이터(${state.count}건)가 이미 수집 완료되었습니다. 작업을 건너뜁니다.`);
          log(`(강제로 다시 실행하려면 'node scraper/daily_crawler.js --force'를 실행하세요.)`);
          return;
        }
      } catch (e) {}
    }
  } else {
    log(`[옵션] --force 플래그 적용: 당일 중복 검사를 건너뛰고 강제 수집합니다.`);
  }

  // Cloudflare 통과용 세션 쿠키 초기화
  log(`0단계: 올리브영 브라우저 세션 초기화 중...`);
  await initSessionCookies();

  const collectedMap = new Map();

  // 1. 12개 주요 카테고리 랭킹 100위 수집
  log(`1단계: 12개 카테고리 TOP 100 랭킹 수집 시작`);
  for (const cat of CATEGORIES) {
    const html = await fetchCategoryHtml(cat.catNo);
    if (!html) {
      log(`  ⚠️ [${cat.catName}] 수집 실패 또는 지연 (건너뜀)`);
      continue;
    }
    const items = parseProductsFromHtml(html, cat);
    for (const item of items) {
      collectedMap.set(item.goods_no, item);
    }
    log(`  ✅ [${cat.catName}] ${items.length}개 상품 수집 완료`);
    await new Promise(r => setTimeout(r, 1200));
  }

  log(`  -> 카테고리 랭킹에서 총 ${collectedMap.size}개 유니크 상품 수집 완료`);

  // 2. DB 등록 기존 상품 중 100위 밖으로 이탈한 상품 및 직접 등록 상품 추적
  log(`2단계: DB 기존 등록 상품 목록 확인 및 이탈 상품 가격 갱신`);
  try {
    const existingDbProducts = await fetchAllDbProducts();
    log(`  -> DB 총 상품 수: ${existingDbProducts.length}개`);

    const outOfRankProducts = existingDbProducts.filter(p => !collectedMap.has(p.goods_no));
    log(`  -> 오늘 랭킹 밖 지속 추적 대상: ${outOfRankProducts.length}개 상품`);

    let outCount = 0;
    for (const p of outOfRankProducts) {
      const scraped = await fetchSingleProductDetail(p.goods_no);
      if (scraped && scraped.price) {
        const cleanUrl = (p.url || `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${p.goods_no}`).replace(/&rank=[0-9]+/, '');
        collectedMap.set(p.goods_no, {
          goods_no: p.goods_no,
          name: p.name || scraped.name,
          price: scraped.price,
          url: cleanUrl,
          is_custom: p.is_custom || false
        });
        outCount++;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    log(`  -> 랭킹 밖 상품 중 ${outCount}개 가격 최신 갱신 완료`);
  } catch (err) {
    log(`  ⚠️ DB 기존 상품 추적 중 오류: ${err.message}`);
  }

  const allItems = Array.from(collectedMap.values());
  log(`3단계: Supabase 데이터베이스 저장 (총 ${allItems.length}개 상품)`);

  if (allItems.length === 0) {
    log(`❌ [에러] 수집된 상품이 0개입니다. 네트워크 상태를 확인해주세요.`);
    process.exit(1);
  }

  // products 테이블 갱신/신규등록
  const productPayloads = allItems.map(p => ({
    goods_no: p.goods_no,
    name: p.name,
    url: p.url,
    is_custom: p.is_custom || false
  }));
  await batchUpsertProducts(productPayloads);

  // prices 테이블 당일 가격 저장
  await batchUpsertPrices(allItems, today);

  log(`🎉 전체 가격 데이터 동기화 완료! (총 ${allItems.length}건 기록)`);

  // 마지막 성공 상태 기록
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    last_run: today,
    count: allItems.length,
    status: 'success',
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8');

  // 쿠키 파일 정리
  try {
    if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE);
  } catch (e) {}

  log(`상태 저장 완료: ${STATE_FILE}`);
  log(`====================================================\n`);
}

main().catch(err => {
  log(`[FATAL ERROR] 스크래퍼 실행 중 치명적 오류: ${err.stack || err.message}`);
  process.exit(1);
});
