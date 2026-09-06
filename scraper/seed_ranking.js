/**
 * 올리브영 카테고리별 랭킹 TOP 100 수집 및 Supabase 등록 스크립트 (안정형 증분 저장)
 */
const { spawn } = require('child_process');

process.env.PATH = `C:\\Program Files\\Git\\mingw64\\bin;${process.env.PATH}`;

const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

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

function fetchCategoryHtml(catNo, maxRetries = 3) {
  return new Promise(async (resolve) => {
    const url = `https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo=${catNo}&pageIdx=1&rowsPerPage=100`;
    const args = [
      '-s',
      '-L',
      '--compressed',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      '-H', 'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      url
    ];

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let output = '';
      const success = await new Promise((resAttempt) => {
        try {
          const child = spawn('curl.exe', args);
          child.stdout.on('data', chunk => { output += chunk; });
          child.on('error', () => resAttempt(false));
          child.on('close', code => {
            if (code === 0 && output.length > 50000) {
              resAttempt(true);
            } else {
              resAttempt(false);
            }
          });
        } catch (e) {
          resAttempt(false);
        }
      });

      if (success) {
        return resolve(output);
      }

      console.log(`    (재시도 ${attempt}/${maxRetries}) 2초 대기 중...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    resolve('');
  });
}

function parseProductsFromHtml(html, cat) {
  const items = [];
  const prdInfoBlocks = html.split(/<div class="prd_info\s*">/g);

  for (let i = 1; i < prdInfoBlocks.length; i++) {
    const block = prdInfoBlocks[i].split(/<\/div>\s*<\/li>/)[0];

    // goodsNo
    const goodsNoMatch = block.match(/data-ref-goodsNo="([A-Za-z0-9]+)"/i);
    if (!goodsNoMatch) continue;
    const goodsNo = goodsNoMatch[1];

    // rank
    const rankMatch = block.match(/<span class="thumb_flag[^"]*">([0-9]+)<\/span>/i);
    const rank = rankMatch ? parseInt(rankMatch[1], 10) : i;

    // name
    let name = '';
    const nameMatch = block.match(/data-ref-goodsnm="([^"]+)"/i) || block.match(/<p class="tx_name">([^<]+)<\/p>/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }

    // price
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

async function batchUpsertProducts(products) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  const CHUNK_SIZE = 100;
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE).map(p => ({
      goods_no: p.goods_no,
      name: p.name,
      url: p.url,
      is_custom: false
    }));

    await fetch(`${SUPABASE_URL}/rest/v1/products?on_conflict=goods_no`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk)
    });
  }
}

async function batchInsertPrices(products, todayDate) {
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=ignore-duplicates'
  };

  const CHUNK_SIZE = 100;
  for (let i = 0; i < products.length; i += CHUNK_SIZE) {
    const chunk = products.slice(i, i + CHUNK_SIZE).map(p => ({
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
  const today = new Date().toISOString().split('T')[0];
  console.log(`=== 올리브영 카테고리 랭킹 TOP 100 일괄 수집 및 등록 시작 (${today}) ===\n`);

  let totalRegistered = 0;

  for (const cat of CATEGORIES) {
    console.log(`[카테고리] '${cat.catName}'(코드: ${cat.catNo}) 랭킹 100위 수집 중...`);
    const html = await fetchCategoryHtml(cat.catNo);
    if (!html) {
      console.log(`  -> [경고] '${cat.catName}' 수집 실패`);
      continue;
    }

    const items = parseProductsFromHtml(html, cat);
    console.log(`  -> ${items.length}개 상품 파싱 성공. DB 저장 중...`);

    if (items.length > 0) {
      await batchUpsertProducts(items);
      await batchInsertPrices(items, today);
      totalRegistered += items.length;
      console.log(`  -> '${cat.catName}' DB 저장 완료!`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== 전체 등록 완료! 누적 처리 상품: ${totalRegistered}건 ===`);
}

main().catch(err => {
  console.error('Fatal Error:', err);
});
