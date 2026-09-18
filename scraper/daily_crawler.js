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
const COOKIE_FILE_PC = path.join(__dirname, 'cookies_pc.txt');
const COOKIE_FILE_MOB = path.join(__dirname, 'cookies_mob.txt');

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
  // 한국 표준시(KST, Asia/Seoul) 기준 YYYY-MM-DD 반환 (자정~오전 9시 UTC 날짜 밀림 방지)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  } catch (e) {
    const now = new Date();
    const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    return kstTime.toISOString().split('T')[0];
  }
}

// PC 부팅 직후 네트워크(Wi-Fi/LAN) 연결 지연 대비 최대 30초 대기
async function waitForNetwork(maxWaitSec = 30) {
  const startTime = Date.now();
  let attempts = 0;
  while ((Date.now() - startTime) < maxWaitSec * 1000) {
    attempts++;
    const isOnline = await new Promise((resolve) => {
      try {
        const child = spawn('curl.exe', ['-s', '-I', '-m', '3', '-o', 'NUL', 'https://www.oliveyoung.co.kr/'], { stdio: ['ignore', 'ignore', 'ignore'] });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      } catch (e) {
        resolve(false);
      }
    });

    if (isOnline) {
      if (attempts > 1) {
        log(`  -> 네트워크 연결 확인 완료 (${attempts}회차 시도 성공)`);
      }
      return true;
    }

    if (attempts === 1) {
      log(`  ⏳ 네트워크(인터넷) 연결 대기 중...`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  log(`  ⚠️ 네트워크 연결 대기 시간 초과(30초), 수집을 계속 진행합니다.`);
  return false;
}

function initCookieForUrl(url, cookieFile, userAgent) {
  return new Promise((resolve) => {
    const args = [
      '-s', '-L',
      '-c', cookieFile,
      '-A', userAgent,
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9',
      '-m', '6',
      '-o', 'NUL',
      url
    ];
    try {
      const child = spawn('curl.exe', args, { stdio: ['ignore', 'ignore', 'ignore'] });
      child.on('close', () => resolve(true));
      child.on('error', () => resolve(false));
    } catch (e) {
      resolve(false);
    }
  });
}

// 0. Cloudflare 세션 쿠키 초기화 (PC 랭킹용 및 모바일 상세용 독립 세션 발급)
async function initSessionCookies() {
  await initCookieForUrl('https://www.oliveyoung.co.kr/', COOKIE_FILE_PC, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
  await initCookieForUrl('https://m.oliveyoung.co.kr/', COOKIE_FILE_MOB, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
  return true;
}

// 1. 카테고리별 PC 랭킹 100위 HTML 가져오기 (PC 전용 쿠키 세션 유지)
function fetchCategoryHtml(catNo, maxRetries = 2) {
  return new Promise(async (resolve) => {
    const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${catNo}&pageIdx=1&rowsPerPage=100`;
    const args = [
      '-s', '-L', '--compressed',
      '-b', COOKIE_FILE_PC,
      '-c', COOKIE_FILE_PC,
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      '-H', 'Referer: https://www.oliveyoung.co.kr/store/main/getBestList.do',
      '-m', '10',
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
      await initCookieForUrl('https://www.oliveyoung.co.kr/', COOKIE_FILE_PC, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
      await new Promise(r => setTimeout(r, 1500));
    }

    resolve('');
  });
}

function parseProductsFromHtml(html, cat, discontinuedSet = new Set()) {
  const validItems = [];
  const brokenOrDiscontinuedItems = [];

  // li 단위 또는 prd_info 단위 블록 분할 (품절/판매종료 플래그를 온전히 포함하기 위해 li 우선 분할)
  const liBlocks = html.split(/<li\s+class="flag"/i);
  const blocksToProcess = liBlocks.length > 1 ? liBlocks.slice(1) : html.split(/<div class="prd_info\s*">/g).slice(1);

  for (let i = 0; i < blocksToProcess.length; i++) {
    const block = blocksToProcess[i].split(/<\/li>/)[0];

    const goodsNoMatch = block.match(/data-ref-goodsNo="([A-Za-z0-9]+)"/i) || block.match(/goodsNo=([A-Za-z0-9]+)/i);
    if (!goodsNoMatch) continue;
    const goodsNo = goodsNoMatch[1];

    let name = '';
    const nameMatch = block.match(/data-ref-goodsnm="([^"]+)"/i) || block.match(/<p class="tx_name">([^<]+)<\/p>/i);
    if (nameMatch) {
      name = decodeHtmlEntities(nameMatch[1].trim());
    }

    let price = 0;
    const priceMatch = block.match(/<span class="tx_cur"[^>]*>[\s\S]*?<span class="tx_num">([^<]+)<\/span>/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
    }

    // 품절, 판매종료, 구매불가 여부 감지
    const isSoldOut =
      block.includes('icon_flag soldout') ||
      block.includes('class="soldout"') ||
      block.includes('일시품절') ||
      block.includes('판매종료') ||
      block.includes('구매불가') ||
      block.includes('판매중단');

    const isAlreadyDiscontinued = discontinuedSet.has(goodsNo);
    const isPriceMissing = (!price || price <= 0);

    const isDiscontinuedOrBroken = isSoldOut || isAlreadyDiscontinued || isPriceMissing;

    if (goodsNo && name) {
      if (!isDiscontinuedOrBroken && price > 0) {
        validItems.push({
          goods_no: goodsNo,
          name: name,
          price: price,
          category: cat.catName,
          cat_no: cat.catNo,
          is_discontinued: false
        });
      } else {
        const cleanName = name.replace(/^\[판매종료\]\s*/, '').trim();
        brokenOrDiscontinuedItems.push({
          goods_no: goodsNo,
          name: `[판매종료] ${cleanName}`,
          price: price > 0 ? price : null,
          category: cat.catName,
          cat_no: cat.catNo,
          is_discontinued: true
        });
      }
    }
  }

  // [재정렬] 정상 판매 상품은 1위부터 순서대로, 판매종료/링크불가 제품은 100위 목록의 가장 끝으로 재배치
  const reordered = [];
  let currentRank = 1;

  for (const item of validItems) {
    reordered.push({
      ...item,
      rank: currentRank,
      url: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${item.goods_no}&dispCatNo=${cat.catNo}&catName=${encodeURIComponent(cat.catName)}&rank=${currentRank}`
    });
    currentRank++;
  }

  for (const item of brokenOrDiscontinuedItems) {
    reordered.push({
      ...item,
      rank: null, // 판매종료/링크불가 상품은 랭킹 태그를 부여하지 않음 (순위 없음)
      url: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${item.goods_no}&dispCatNo=${cat.catNo}&catName=${encodeURIComponent(cat.catName)}&status=discontinued`
    });
  }

  return reordered;
}

function extractCategoryFromHtml(html) {
  if (!html) return null;

  // 1. Breadcrumb 영역 우선 추출
  const breadcrumbBlock = html.match(/Breadcrumb_breadcrumb-inner[\s\S]*?<\/div>/i);
  if (breadcrumbBlock) {
    const links = breadcrumbBlock[0].match(/role="link">([^<]+)<\/a>/g) || [];
    for (const link of links) {
      const nameMatch = link.match(/role="link">([^<]+)<\/a>/);
      if (nameMatch) {
        const catName = nameMatch[1].trim();
        const found = CATEGORIES.find(c => c.catName === catName);
        if (found) return found.catName;
        for (const c of CATEGORIES) {
          if (catName.includes(c.catName) || c.catName.includes(catName)) return c.catName;
        }
      }
    }
  }

  // 2. 전체 link 요소에서 매칭
  const allLinks = html.match(/role="link">([^<]+)<\/a>/g) || [];
  for (const link of allLinks) {
    const nameMatch = link.match(/role="link">([^<]+)<\/a>/);
    if (nameMatch) {
      const catName = nameMatch[1].trim();
      const found = CATEGORIES.find(c => c.catName === catName);
      if (found) return found.catName;
    }
  }

  // 3. JSON 내부 카테고리명 매칭
  const jsonMatch = html.match(/"middleCategoryName"\s*:\s*"([^"]+)"/) || html.match(/"upperCategoryName"\s*:\s*"([^"]+)"/);
  if (jsonMatch) {
    const catName = jsonMatch[1].trim();
    for (const c of CATEGORIES) {
      if (catName.includes(c.catName) || c.catName.includes(catName)) return c.catName;
    }
  }

  return null;
}

function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderProgressBar(current, total, startTime, extraInfo = '') {
  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100;
  const barLength = 22;
  const filled = total > 0 ? Math.round((barLength * current) / total) : barLength;
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLength - filled));
  
  const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
  const speed = (current / elapsedSec).toFixed(1);
  const remainSec = speed > 0 ? Math.max(0, Math.round((total - current) / speed)) : 0;

  const line = `\r  ⏳ [${bar}] ${String(percent).padStart(3, ' ')}% (${String(current).padStart(4, ' ')}/${total}) | ${speed}개/초 | 경과 ${formatTime(elapsedSec)} | 남은시간 ${formatTime(remainSec)} ${extraInfo ? '| ' + extraInfo : ''}`;
  process.stdout.write(line);
}

// 2. 단일 상품 상세 페이지에서 가격 및 카테고리 조회 (모바일 전용 URL + 1회 쿨다운 재시도)
async function fetchSingleProductDetail(goodsNo, retryCount = 0) {
  const url = `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;
  const args = [
    '-s', '-L', '--compressed',
    '-b', COOKIE_FILE_MOB,
    '-c', COOKIE_FILE_MOB,
    '-A', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: ko-KR,ko;q=0.9',
    '-m', '6',
    url
  ];

  return new Promise((resolve) => {
    try {
      const child = spawn('curl.exe', args);
      let chunks = [];
      child.stdout.on('data', c => chunks.push(c));
      child.on('close', async code => {
        if (code !== 0) return resolve(null);
        const text = Buffer.concat(chunks).toString('utf8');

        // Cloudflare 챌린지 감지 시 1회 3초 대기 후 모바일 세션 갱신 재시도
        if (text.includes('challenge-platform') || text.includes('잠시만 기다려 주세요')) {
          if (retryCount === 0) {
            await initCookieForUrl('https://m.oliveyoung.co.kr/', COOKIE_FILE_MOB, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
            await new Promise(r => setTimeout(r, 3000));
            const retryRes = await fetchSingleProductDetail(goodsNo, 1);
            return resolve(retryRes);
          }
          return resolve({ challenge: true });
        }

        // 1. 가격 정보 우선 파싱 (정상 판매 상품 판별의 핵심 기준)
        const fpMatch = text.match(/finalPrice(?:\\*)"\s*:\s*([0-9]+)/) || text.match(/salePrice(?:\\*)"\s*:\s*([0-9]+)/) || text.match(/<span class="price-2"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/i);
        let price = null;
        if (fpMatch) {
          price = parseInt(fpMatch[1].replace(/,/g, ''), 10);
        }

        const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
        const ogTitleMatch = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const gnMatch = text.match(/goodsName(?:\\*)"\s*:\s*(?:\\*)"([^"\\]+)/) || text.match(/<p class="prd_name">([^<]+)<\/p>/i) || text.match(/data-ref-goodsnm="([^"]+)"/i);

        let name = null;
        if (titleMatch) {
          name = decodeHtmlEntities(titleMatch[1].replace(/\s*\|\s*올리브영.*$/, ''));
        } else if (ogTitleMatch) {
          name = decodeHtmlEntities(ogTitleMatch[1].replace(/\s*\|\s*올리브영.*$/, ''));
        } else if (gnMatch) {
          name = decodeHtmlEntities(gnMatch[1]);
        }

        // 2. 판매종료/중지/미존재 상품 감지 (명시적 SSR 단종 사유 및 레거시 안내 문구)
        const hasExplicitDiscontinuedReason =
          text.includes('ssr:display-period-ended') || // 전시 기간 종료 (판매종료)
          text.includes('ssr:catalog-error-code') ||     // 카탈로그 에러 (미존재 상품)
          text.includes('상품을 찾을 수 없어요') ||
          text.includes('판매종료 또는 중지') ||
          text.includes('더 이상 판매되지') ||
          text.includes('판매가 중단') ||
          text.includes('판매 종료된 상품') ||
          text.includes('구매할 수 없는 상품');

        const isDefaultMallTitle = (name === '올리브영 온라인몰' || name === '올리브영' || !name);

        // 가격이 없으면서 명시적 단종 사유가 있거나 기본 쇼핑몰 타이틀인 경우만 미존재/판매종료로 판정
        if (!price && (hasExplicitDiscontinuedReason || isDefaultMallTitle)) {
          return resolve({ notFound: true, isDiscontinued: true, name: (name && name !== '올리브영 온라인몰' ? name : null) });
        }

        let category = extractCategoryFromHtml(text);

        resolve({ name, price, category });
      });
      child.on('error', () => resolve(null));
    } catch (e) {
      resolve(null);
    }
  });
}

// 기존 DB에 등록된 판매종료 상품 goods_no Set 조회 (랭킹 파싱 시 판매종료 교차 검증용)
async function fetchDiscontinuedGoodsNos() {
  const set = new Set();
  let from = 0;
  const limit = 1000;

  while (true) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=goods_no&or=(url.like.*status=discontinued*,name.like.*판매종료*)&range=${from}-${from + limit - 1}`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (!res.ok) break;
      const data = await res.json();
      if (!data || data.length === 0) break;
      data.forEach(p => {
        if (p.goods_no) set.add(p.goods_no);
      });
      if (data.length < limit) break;
      from += limit;
    } catch (e) {
      break;
    }
  }

  return set;
}

// 3. Supabase DB 헬퍼 (페이징 전체 조회 및 일괄 저장)
async function fetchAllDbProducts() {
  const all = [];
  let from = 0;
  const limit = 1000;

  while (true) {
    // 판매종료(status=discontinued 또는 [판매종료] 명명)된 상품은 DB 조회 시점부터 제외하여 수집 부하 최소화
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=goods_no,name,url,is_custom&url=not.like.*status=discontinued*&name=not.like.*판매종료*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Range': `${from}-${from + limit - 1}`
      }
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data || data.length === 0) break;
    // URL 필터 2차 검증
    const activeData = data.filter(p => !p.url || !p.url.includes('status=discontinued'));
    all.push(...activeData);
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

  // Cloudflare 통과용 세션 쿠키 초기화 및 네트워크 연결 확인
  log(`0단계: 올리브영 브라우저 세션 초기화 및 네트워크 확인 중...`);
  await waitForNetwork();
  await initSessionCookies();

  const collectedMap = new Map();

  // 1. 12개 주요 카테고리 랭킹 100위 수집
  log(`1단계: 12개 카테고리 TOP 100 랭킹 수집 시작 (판매종료/품절 상품 최하위 재정렬 적용)`);
  const existingDiscontinuedSet = await fetchDiscontinuedGoodsNos();
  if (existingDiscontinuedSet.size > 0) {
    log(`  -> 기존 DB 판매종료 등록 상품: ${existingDiscontinuedSet.size}개 확인 (랭킹 수집 시 최하위 재정렬 적용)`);
  }

  for (const cat of CATEGORIES) {
    const html = await fetchCategoryHtml(cat.catNo);
    if (!html) {
      log(`  ⚠️ [${cat.catName}] 수집 실패 또는 지연 (건너뜀)`);
      continue;
    }
    const items = parseProductsFromHtml(html, cat, existingDiscontinuedSet);
    const THEME_CATEGORIES = ['더모 코스메틱', '맨즈에딧'];

    for (const item of items) {
      if (collectedMap.has(item.goods_no)) {
        const existing = collectedMap.get(item.goods_no);
        // 기존이 제형 본 카테고리(스킨케어, 클렌징 등)이고 현재가 테마 카테고리면 기존 본 카테고리 랭킹 보존
        if (THEME_CATEGORIES.includes(cat.catName) && !THEME_CATEGORIES.includes(existing.category)) {
          continue;
        }
      }
      collectedMap.set(item.goods_no, item);
    }
    log(`  ✅ [${cat.catName}] ${items.length}개 상품 수집 완료`);
    await new Promise(r => setTimeout(r, 1200));
  }

  const rankingCount = collectedMap.size;
  log(`  -> 카테고리 랭킹에서 총 ${rankingCount}개 유니크 상품 수집 완료`);

  // 2. DB 등록 기존 상품 중 100위 밖으로 이탈한 상품 및 직접 등록 상품 전수 추적
  log(`2단계: 랭킹 밖 등록 상품 전수 추적 및 판매종료 상품 자동 격리`);
  const discontinuedList = [];
  let outCount = 0;
  let autoCatCount = 0;

  try {
    const existingDbProducts = await fetchAllDbProducts();
    log(`  -> DB 총 활성 상품 수: ${existingDbProducts.length}개 (판매종료 상품 제외됨)`);

    const outOfRankProducts = existingDbProducts.filter(p => !collectedMap.has(p.goods_no));
    
    // 사용자 직접 등록(is_custom) 상품 최우선 배치
    const customProducts = outOfRankProducts.filter(p => p.is_custom);
    const normalProducts = outOfRankProducts.filter(p => !p.is_custom);
    const targetProducts = [...customProducts, ...normalProducts];

    log(`  -> 랭킹 밖 지속 추적 대상: 총 ${targetProducts.length}개 (직접 등록 관심상품: ${customProducts.length}개)`);

    let consecutiveChallenges = 0;
    const totalOut = targetProducts.length;
    const startTimeStep2 = Date.now();

    for (let i = 0; i < totalOut; i++) {
      const p = targetProducts[i];
      const scraped = await fetchSingleProductDetail(p.goods_no);

      if (scraped && scraped.challenge) {
        consecutiveChallenges++;
        // 4회 연속 챌린지 시 세션 재발급 후 5초 쿨다운
        if (consecutiveChallenges === 4) {
          log(`\n  ⏳ WAF 챌린지 감지: 모바일 세션을 재발급하고 5초간 대기합니다...`);
          await initCookieForUrl('https://m.oliveyoung.co.kr/', COOKIE_FILE_MOB, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
          await new Promise(r => setTimeout(r, 5000));
        } else if (i >= customProducts.length && consecutiveChallenges >= 8) {
          process.stdout.write('\n');
          log(`  ⚠️ 올리브영 일일 요청 상한(WAF Rate-Limit) 감지: 랭킹 밖 일반 상품 조회를 안전하게 조기 마감하고 DB 저장 단계로 전환합니다.`);
          break;
        }
      } else {
        consecutiveChallenges = 0;
      }

      // 판매종료/미존재 상품 감지 시 DB URL에 &status=discontinued 결합 및 상품명에 [판매종료] 태그 부여
      if (scraped && (scraped.notFound || scraped.isDiscontinued)) {
        let discUrl = (p.url || `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${p.goods_no}`)
          .replace(/([?&])rank=[0-9]+&?/g, '$1')
          .replace(/[?&]$/, '');
        if (!discUrl.includes('status=discontinued')) {
          discUrl += (discUrl.includes('?') ? '&status=discontinued' : '?status=discontinued');
        }

        const rawName = scraped.name || p.name || `올리브영 상품 (${p.goods_no})`;
        const cleanName = rawName.replace(/^\[판매종료\]\s*/, '').trim();
        const updatedName = `[판매종료] ${cleanName}`;

        if (!p.url?.includes('status=discontinued') || !p.name?.startsWith('[판매종료]')) {
          discontinuedList.push({
            goods_no: p.goods_no,
            name: updatedName,
            url: discUrl,
            is_custom: p.is_custom || false
          });
          log(`    ⛔ [판매종료 감지] ${p.goods_no}: ${updatedName}`);
        }
      }

      if (scraped && scraped.price) {
        let cleanUrl = (p.url || `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${p.goods_no}`).replace(/&rank=[0-9]+/, '');

        // 1. 기존 URL에서 현재 등록된 카테고리 정보 확인
        let existingCat = null;
        try {
          const u = new URL(cleanUrl);
          const cp = u.searchParams.get('catName') || u.searchParams.get('category');
          if (cp) existingCat = decodeURIComponent(cp);
        } catch (e) {
          const m = cleanUrl.match(/[?&](?:catName|category)=([^&]+)/);
          if (m) existingCat = decodeURIComponent(m[1]);
        }

        // 2. 올리브영 상세 페이지에서 파싱된 실제 공식 카테고리가 있다면 자동 보정/보강
        if (scraped.category) {
          const matchedCat = CATEGORIES.find(c => c.catName === scraped.category);
          if (!existingCat || existingCat !== scraped.category) {
            try {
              const u = new URL(cleanUrl);
              u.searchParams.set('catName', scraped.category);
              if (matchedCat) {
                u.searchParams.set('dispCatNo', matchedCat.catNo);
              }
              cleanUrl = u.toString();
            } catch (e) {
              cleanUrl = cleanUrl.replace(/([?&])(?:catName|dispCatNo)=[^&]*/g, '');
              const catParam = `&catName=${encodeURIComponent(scraped.category)}${matchedCat ? `&dispCatNo=${matchedCat.catNo}` : ''}`;
              cleanUrl += (cleanUrl.includes('?') ? catParam : `?goodsNo=${p.goods_no}${catParam}`);
            }
            autoCatCount++;
            if (existingCat && existingCat !== scraped.category) {
              log(`    🔄 [카테고리 자동 보정] ${p.name || p.goods_no}: '${existingCat}' -> '${scraped.category}'`);
            }
          }
        }

        collectedMap.set(p.goods_no, {
          goods_no: p.goods_no,
          name: p.name || scraped.name,
          price: scraped.price,
          url: cleanUrl,
          is_custom: p.is_custom || false
        });
        outCount++;
      }

      // 콘솔 실시간 프로그레스 바 렌더링 (진행률, 남은 시간, 상태)
      renderProgressBar(i + 1, totalOut, startTimeStep2, `가격갱신: ${outCount} | 판매종료격리: ${discontinuedList.length}`);

      // 로그 파일에는 50개 단위로 진행 상황 기록
      if ((i + 1) % 50 === 0 || i + 1 === totalOut) {
        try {
          const line = `[${new Date().toLocaleTimeString('ko-KR')}] ⏳ [${i + 1}/${totalOut}] 진행 중 (가격 갱신: ${outCount}개, 판매종료: ${discontinuedList.length}개)`;
          fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
        } catch (e) {}
      }

      // 지능형 쿨다운: 30개 요청마다 2초간 쉬고 세션 갱신하여 WAF 챌린지 방지
      if ((i + 1) % 30 === 0) {
        await initCookieForUrl('https://m.oliveyoung.co.kr/', COOKIE_FILE_MOB, 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1');
        await new Promise(r => setTimeout(r, 2000));
      } else {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    process.stdout.write('\n');

    // 랭킹에 진입한 직접 등록 상품의 is_custom 플래그 보존
    for (const p of existingDbProducts) {
      if (collectedMap.has(p.goods_no) && p.is_custom) {
        const item = collectedMap.get(p.goods_no);
        item.is_custom = true;
      }
    }

    log(`  -> 랭킹 밖 상품 중 ${outCount}개 가격 갱신 완료 (카테고리 자동 보정: ${autoCatCount}개)`);
    if (discontinuedList.length > 0) {
      log(`  -> 판매종료/단종 감지 상품: ${discontinuedList.length}개 (다음날부터 수집 대상에서 자동 제외)`);
      await batchUpsertProducts(discontinuedList);
    }
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

  // prices 테이블 당일 가격 저장 (유효한 가격이 있는 정상 상품만 저장)
  const validPrices = allItems.filter(p => p.price && p.price > 0);
  await batchUpsertPrices(validPrices, today);

  log(`🎉 전체 가격 데이터 동기화 완료! (총 ${allItems.length}건 기록)`);
  log(`   - 랭킹 수집 상품: ${rankingCount}건`);
  log(`   - 랭킹 밖 가격 갱신: ${outCount}건`);
  log(`   - 판매종료 격리 마킹: ${discontinuedList.length}건`);

  // 마지막 성공 상태 기록
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    last_run: today,
    count: allItems.length,
    status: 'success',
    updated_at: new Date().toISOString()
  }, null, 2), 'utf8');

  // 쿠키 파일 정리
  try {
    if (fs.existsSync(COOKIE_FILE_PC)) fs.unlinkSync(COOKIE_FILE_PC);
    if (fs.existsSync(COOKIE_FILE_MOB)) fs.unlinkSync(COOKIE_FILE_MOB);
  } catch (e) {}

  log(`상태 저장 완료: ${STATE_FILE}`);
  log(`====================================================\n`);
}

main().catch(err => {
  log(`[FATAL ERROR] 스크래퍼 실행 중 치명적 오류: ${err.stack || err.message}`);
  process.exit(1);
});
