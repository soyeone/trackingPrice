/**
 * 단일 상품 즉시 등록 및 가격 트래킹 스크립트
 * 사용법: node scraper/track_product.js <올리브영 URL 또는 goodsNo> [가격] [제품명]
 */
const { spawn } = require('child_process');

process.env.PATH = `C:\\Program Files\\Git\\mingw64\\bin;${process.env.PATH}`;

const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

function extractGoodsNo(input) {
  if (!input) return null;
  const match = input.match(/goodsNo=([A-Za-z0-9]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9]+$/.test(input.trim())) return input.trim();
  return null;
}

function scrapeOliveYoungDetail(goodsNo) {
  return new Promise((resolve) => {
    const url = `https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;
    const args = [
      '-s', '-L', '--compressed',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9',
      url
    ];

    try {
      const child = spawn('curl.exe', args);
      let chunks = [];
      child.stdout.on('data', c => chunks.push(c));
      child.on('close', code => {
        if (code !== 0) {
          console.error('[scrapeOliveYoungDetail] curl close code:', code);
          return resolve(null);
        }
        const text = Buffer.concat(chunks).toString('utf8');

        const gnMatch = text.match(/goodsName(?:\\*)"\s*:\s*(?:\\*)"([^"\\]+)/);
        const fpMatch = text.match(/finalPrice(?:\\*)"\s*:\s*([0-9]+)/) || text.match(/salePrice(?:\\*)"\s*:\s*([0-9]+)/);

        let name = gnMatch ? gnMatch[1] : null;
        let price = fpMatch ? parseInt(fpMatch[1], 10) : null;
        resolve({ name, price });
      });
      child.on('error', (e) => {
        console.error('[scrapeOliveYoungDetail] spawn error:', e);
        resolve(null);
      });
    } catch (e) {
      console.error('[scrapeOliveYoungDetail] catch error:', e);
      resolve(null);
    }
  });
}

async function trackSingleProduct(input, manualPrice, manualName) {
  const goodsNo = extractGoodsNo(input);
  if (!goodsNo) {
    console.error('[오류] 유효한 goodsNo 또는 올리브영 URL을 입력해주세요.');
    process.exit(1);
  }

  console.log(`[즉시 트래킹] 상품번호: ${goodsNo}`);

  let name = manualName;
  let price = manualPrice ? parseInt(manualPrice, 10) : null;

  if (!name || !price) {
    console.log('올리브영에서 실시간 제품 정보 및 가격 조회 중...');
    const scraped = await scrapeOliveYoungDetail(goodsNo);
    if (scraped) {
      if (!name) name = scraped.name;
      if (!price) price = scraped.price;
    }
  }

  name = name || `올리브영 상품 (${goodsNo})`;
  const productUrl = input.startsWith('http') ? input : `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo}`;

  console.log(` -> 제품명: ${name}`);
  console.log(` -> 현재가: ${price ? price.toLocaleString() + '원' : '가격 미확인'}`);

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  // 1. products 테이블에 등록 / 업데이트 (upsert)
  const productPayload = {
    goods_no: goodsNo,
    name: name,
    url: productUrl,
    is_custom: true
  };

  const pRes = await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=goods_no`, {
    method: 'POST',
    headers,
    body: JSON.stringify(productPayload)
  });

  if (!pRes.ok) {
    const errText = await pRes.text();
    console.warn('[경고] 상품 정보 등록 응답:', pRes.status, errText);
  } else {
    console.log('✅ products 테이블 등록/업데이트 완료');
  }

  // 2. prices 테이블에 오늘 일자 가격 즉시 저장
  if (price && price > 0) {
    const today = new Date().toISOString().split('T')[0];
    const pricePayload = {
      goods_no: goodsNo,
      price: price,
      date: today
    };

    const prRes = await fetch(`${SUPABASE_URL}/rest/v1/prices?on_conflict=goods_no,date`, {
      method: 'POST',
      headers,
      body: JSON.stringify(pricePayload)
    });

    if (!prRes.ok) {
      const errText = await prRes.text();
      console.warn('[경고] 가격 기록 저장 응답:', prRes.status, errText);
    } else {
      console.log(`✅ prices 테이블에 오늘(${today}) 가격(${price.toLocaleString()}원) 기록 완료`);
      console.log(`🎉 [즉시 트래킹 성공] 이제 대시보드(index.html#goodsNo=${goodsNo})에서 바로 가격 추이와 단위가격을 확인할 수 있습니다!`);
    }
  } else {
    console.log('⚠️ 실시간 가격을 파싱하지 못하여 상품 기본 정보만 등록되었습니다.');
  }

  return { goodsNo, name, price };
}

const arg = process.argv[2];
const argPrice = process.argv[3];
const argName = process.argv[4];

if (arg) {
  trackSingleProduct(arg, argPrice, argName).catch(console.error);
}

module.exports = { scrapeOliveYoungDetail, extractGoodsNo, trackSingleProduct };
