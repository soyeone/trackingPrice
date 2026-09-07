/**
 * 올리브영 가격 추적기 로컬 서버 및 실시간 스크래핑 API
 * 실행: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

process.env.PATH = `C:\\Program Files\\Git\\mingw64\\bin;${process.env.PATH}`;

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const { scrapeOliveYoungDetail, extractGoodsNo } = require('./scraper/track_product');

const server = http.createServer(async (req, res) => {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = reqUrl.pathname;

  // 1. 올리브영 실시간 정보 조회 API: GET /api/scrape?goodsNo=...
  if (pathname === '/api/scrape') {
    const rawTarget = reqUrl.searchParams.get('goodsNo') || reqUrl.searchParams.get('url');
    const goodsNo = extractGoodsNo(rawTarget);

    if (!goodsNo) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '올바른 goodsNo 또는 URL이 전달되지 않았습니다.' }));
      return;
    }

    try {
      console.log(`[API /api/scrape] 올리브영 실시간 상품 조회 요청: ${goodsNo}`);
      const scraped = await scrapeOliveYoungDetail(goodsNo);
      if (!scraped || (!scraped.name && !scraped.price)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: '올리브영 상품 정보를 파싱하지 못했습니다.' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      const catParam = scraped.category ? `&catName=${encodeURIComponent(scraped.category)}` : '';
      res.end(JSON.stringify({
        success: true,
        goodsNo,
        name: scraped.name,
        price: scraped.price,
        category: scraped.category || null,
        url: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${goodsNo}${catParam}`
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  // 2. 정적 파일 서빙
  let filePath = path.join(ROOT, pathname === '/' ? '/index.html' : pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 올리브영 가격 추적기 서버 시작: http://localhost:${PORT}`);
  console.log(`   - 대시보드: http://localhost:${PORT}/index.html`);
  console.log(`   - 제품 등록: http://localhost:${PORT}/register.html`);
});
