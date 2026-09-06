// Supabase 설정
const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

// Supabase 클라이언트 초기화
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 전역 데이터 저장소
let allProducts = [];
let pricesByGoodsNo = {};
let currentChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 등록 페이지 로직 (register.html)
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        setupRegisterPage(registerForm);
        return;
    }

    // 2. 대시보드 페이지 로직 (index.html)
    const productListView = document.getElementById('product-list-view');
    if (productListView) {
        await initDashboard();
    }
});

/**
 * 대시보드 초기화 및 데이터 로딩
 */
async function initDashboard() {
    const loadingSpinner = document.getElementById('loading-spinner');
    const productListView = document.getElementById('product-list-view');
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    const backToListBtn = document.getElementById('back-to-list-btn');

    try {
        // DB에서 제품 목록 및 가격 목록 동시 조회
        const [productsRes, pricesRes] = await Promise.all([
            supabaseClient.from('products').select('*'),
            supabaseClient.from('prices').select('*').order('date', { ascending: true })
        ]);

        if (productsRes.error) throw productsRes.error;
        if (pricesRes.error) throw pricesRes.error;

        const rawProducts = productsRes.data || [];
        const rawPrices = pricesRes.data || [];

        // 가격 데이터를 goods_no 키로 그룹핑
        pricesByGoodsNo = {};
        rawPrices.forEach(p => {
            if (!pricesByGoodsNo[p.goods_no]) {
                pricesByGoodsNo[p.goods_no] = [];
            }
            pricesByGoodsNo[p.goods_no].push(p);
        });

        // 각 제품별 통계 계산 및 병합
        allProducts = rawProducts.map(prod => {
            const history = pricesByGoodsNo[prod.goods_no] || [];
            let currentPrice = null;
            let minPrice = null;
            let maxPrice = null;
            let lastDate = null;

            if (history.length > 0) {
                const pricesOnly = history.map(h => h.price);
                currentPrice = history[history.length - 1].price;
                lastDate = history[history.length - 1].date;
                minPrice = Math.min(...pricesOnly);
                maxPrice = Math.max(...pricesOnly);
            }

            return {
                ...prod,
                displayName: prod.name || `올리브영 상품 (${prod.goods_no})`,
                currentPrice,
                minPrice,
                maxPrice,
                lastDate,
                historyCount: history.length
            };
        });

        // 로딩 화면 숨기고 목록 뷰 표시
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        productListView.style.display = 'block';

        // 검색 이벤트 리스너 등록
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const keyword = e.target.value.trim().toLowerCase();
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = keyword ? 'flex' : 'none';
                }
                renderProductGrid(filterProducts(keyword));
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearSearchBtn.style.display = 'none';
                renderProductGrid(allProducts);
                searchInput.focus();
            });
        }

        if (backToListBtn) {
            backToListBtn.addEventListener('click', () => {
                history.pushState(null, '', window.location.pathname);
                showListView();
            });
        }

        // 브라우저 뒤로가기/앞으로가기 및 URL 해시 감지
        window.addEventListener('popstate', handleUrlRoute);
        window.addEventListener('hashchange', handleUrlRoute);

        // 초기 라우팅 처리
        handleUrlRoute();

    } catch (err) {
        console.error('대시보드 데이터 로드 오류:', err);
        if (loadingSpinner) {
            loadingSpinner.innerHTML = `<p style="color:red;">데이터를 불러오는 중 오류가 발생했습니다: ${err.message}</p>`;
        }
    }
}

/**
 * URL 해시(#goodsNo=...)를 기반으로 뷰 전환
 */
function handleUrlRoute() {
    const hash = window.location.hash;
    if (hash && hash.includes('goodsNo=')) {
        const goodsNo = hash.split('goodsNo=')[1].split('&')[0];
        showDetailView(goodsNo);
    } else {
        showListView();
    }
}

/**
 * 키워드로 제품 필터링
 */
function filterProducts(keyword) {
    if (!keyword) return allProducts;
    return allProducts.filter(p => 
        (p.displayName && p.displayName.toLowerCase().includes(keyword)) ||
        (p.goods_no && p.goods_no.toLowerCase().includes(keyword))
    );
}

/**
 * 제품 그리드 렌더링
 */
function renderProductGrid(products) {
    const grid = document.getElementById('product-grid');
    const noResults = document.getElementById('no-results-msg');
    const searchStats = document.getElementById('search-stats');

    if (!grid) return;
    grid.innerHTML = '';

    if (searchStats) {
        searchStats.textContent = `총 ${products.length}개의 추적 제품이 있습니다.`;
    }

    if (products.length === 0) {
        if (noResults) noResults.style.display = 'block';
        return;
    }

    if (noResults) noResults.style.display = 'none';

    products.forEach(prod => {
        const card = document.createElement('div');
        card.className = 'product-card';

        const tagText = prod.is_custom ? '직접 등록' : '랭킹 추적';
        const tagClass = prod.is_custom ? 'tag-custom' : 'tag-rank';

        let priceHtml = '';
        if (prod.currentPrice !== null) {
            priceHtml = `
                <div class="card-price-row">
                    <span class="card-price-label">현재 가격</span>
                    <div class="card-price">${prod.currentPrice.toLocaleString()}<span>원</span></div>
                </div>
            `;
        } else {
            priceHtml = `
                <div class="card-price-row">
                    <span class="card-price-label">가격 정보</span>
                    <span style="font-size:0.85rem; color:#8b95a1;">수집 대기 중</span>
                </div>
            `;
        }

        card.innerHTML = `
            <div>
                <span class="card-tag ${tagClass}">${tagText}</span>
                <h2 class="card-title">${escapeHtml(prod.displayName)}</h2>
            </div>
            <div>
                ${priceHtml}
                <div class="card-cta">📊 가격 추이 및 상세 보기 →</div>
            </div>
        `;

        card.addEventListener('click', () => {
            window.location.hash = `goodsNo=${prod.goods_no}`;
        });

        grid.appendChild(card);
    });
}

/**
 * 목록 뷰 표시
 */
function showListView() {
    const productListView = document.getElementById('product-list-view');
    const productDetailView = document.getElementById('product-detail-view');

    if (productDetailView) productDetailView.style.display = 'none';
    if (productListView) productListView.style.display = 'block';

    // 현재 검색어에 맞게 그리드 갱신
    const searchInput = document.getElementById('search-input');
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    renderProductGrid(filterProducts(keyword));
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 단일 제품 상세 가격 추적 뷰 표시
 */
function showDetailView(goodsNo) {
    const productListView = document.getElementById('product-list-view');
    const productDetailView = document.getElementById('product-detail-view');

    const product = allProducts.find(p => p.goods_no === goodsNo);
    if (!product) {
        showListView();
        return;
    }

    if (productListView) productListView.style.display = 'none';
    if (productDetailView) productDetailView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 1. 헤더 및 기본 정보 바인딩
    document.getElementById('detail-title').textContent = product.displayName;
    document.getElementById('detail-goods-no').textContent = `상품번호: ${product.goods_no}`;
    
    const customBadge = document.getElementById('detail-custom-badge');
    if (customBadge) {
        customBadge.textContent = product.is_custom ? '직접 등록 상품' : '카테고리 랭킹 상품';
    }

    const oyLink = document.getElementById('detail-oy-link');
    if (oyLink) {
        oyLink.href = product.url || `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${product.goods_no}`;
    }

    // 2. 핵심 지표 바인딩
    const history = pricesByGoodsNo[product.goods_no] || [];
    
    const curValEl = document.getElementById('metric-current');
    const curDateEl = document.getElementById('metric-current-date');
    const minValEl = document.getElementById('metric-min');
    const minDiffEl = document.getElementById('metric-min-diff');
    const maxValEl = document.getElementById('metric-max');
    const daysEl = document.getElementById('metric-days');
    const histCountEl = document.getElementById('metric-history-count');

    if (history.length > 0) {
        const curPrice = history[history.length - 1].price;
        const curDate = history[history.length - 1].date;
        const minPrice = Math.min(...history.map(h => h.price));
        const maxPrice = Math.max(...history.map(h => h.price));

        curValEl.textContent = `${curPrice.toLocaleString()}원`;
        curDateEl.textContent = `기준일: ${curDate}`;

        minValEl.textContent = `${minPrice.toLocaleString()}원`;
        if (curPrice === minPrice) {
            minDiffEl.textContent = '현재 최저가 유지 중! 🎉';
            minDiffEl.style.color = '#3182f6';
        } else {
            const diff = curPrice - minPrice;
            minDiffEl.textContent = `최저가보다 +${diff.toLocaleString()}원 비쌈`;
            minDiffEl.style.color = '#8b95a1';
        }

        maxValEl.textContent = `${maxPrice.toLocaleString()}원`;
        daysEl.textContent = `${history.length}일`;
        histCountEl.textContent = `총 ${history.length}회 수집됨`;
    } else {
        curValEl.textContent = '수집 대기 중';
        curDateEl.textContent = '-';
        minValEl.textContent = '-';
        minDiffEl.textContent = '-';
        maxValEl.textContent = '-';
        daysEl.textContent = '0일';
        histCountEl.textContent = '가격 기록 없음';
    }

    // 3. 차트 렌더링
    renderDetailChart(history);

    // 4. 가격 기록 테이블 렌더링
    renderHistoryTable(history);
}

/**
 * 상세 가격 추이 차트 렌더링
 */
function renderDetailChart(history) {
    const canvas = document.getElementById('detail-chart');
    if (!canvas) return;

    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    if (!history || history.length === 0) {
        return;
    }

    const labels = history.map(h => h.date);
    const data = history.map(h => h.price);

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, 'rgba(155, 210, 32, 0.35)');
    gradient.addColorStop(1, 'rgba(155, 210, 32, 0.0)');

    currentChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '가격 (원)',
                data: data,
                borderColor: '#7fa818',
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.25,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#7fa818',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointHoverBackgroundColor: '#7fa818',
                pointHoverBorderColor: '#ffffff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#191f28',
                    titleFont: { size: 13, family: 'Pretendard' },
                    bodyFont: { size: 14, weight: 'bold', family: 'Pretendard' },
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `₩ ${context.parsed.y.toLocaleString()}원`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        font: { size: 12, family: 'Pretendard' },
                        color: '#8b95a1'
                    }
                },
                y: {
                    grid: {
                        color: '#f0f2f5'
                    },
                    ticks: {
                        font: { size: 12, family: 'Pretendard' },
                        color: '#8b95a1',
                        callback: function(value) {
                            return value.toLocaleString() + '원';
                        }
                    }
                }
            }
        }
    });
}

/**
 * 가격 변동 기록 테이블 렌더링
 */
function renderHistoryTable(history) {
    const tbody = document.getElementById('history-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#8b95a1; padding:2rem;">아직 수집된 가격 변동 기록이 없습니다.</td></tr>`;
        return;
    }

    // 최신 날짜가 위로 오도록 역순 정렬
    const sortedHistory = [...history].reverse();

    sortedHistory.forEach((item, index) => {
        const tr = document.createElement('tr');
        
        let diffHtml = '<span class="diff-same">-</span>';
        let statusHtml = '<span style="color:#8b95a1;">동일</span>';

        // 이전 날짜(배열 상 다음 인덱스)와 비교
        if (index < sortedHistory.length - 1) {
            const prevPrice = sortedHistory[index + 1].price;
            const diff = item.price - prevPrice;
            const diffPct = ((diff / prevPrice) * 100).toFixed(1);

            if (diff < 0) {
                diffHtml = `<span class="diff-down">${diff.toLocaleString()}원 (${diffPct}%)</span>`;
                statusHtml = `<span class="diff-down">가격 인하 📉</span>`;
            } else if (diff > 0) {
                diffHtml = `<span class="diff-up">+${diff.toLocaleString()}원 (+${diffPct}%)</span>`;
                statusHtml = `<span class="diff-up">가격 인상 📈</span>`;
            }
        } else {
            statusHtml = `<span style="color:#3182f6;">최초 수집</span>`;
        }

        tr.innerHTML = `
            <td><b>${item.date}</b></td>
            <td><b>${item.price.toLocaleString()}원</b></td>
            <td>${diffHtml}</td>
            <td>${statusHtml}</td>
        `;

        tbody.appendChild(tr);
    });
}

/**
 * 등록 페이지 폼 처리
 */
function setupRegisterPage(registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const urlInput = document.getElementById('product-url').value;
        const messageEl = document.getElementById('message');

        try {
            const url = new URL(urlInput);
            const goodsNo = url.searchParams.get('goodsNo');
            
            if (!goodsNo) {
                messageEl.textContent = '올바른 올리브영 상품 링크가 아닙니다 (goodsNo 파라미터를 찾을 수 없습니다).';
                messageEl.style.color = '#f04452';
                return;
            }

            messageEl.textContent = '데이터베이스에 제품을 등록하는 중입니다...';
            messageEl.style.color = '#3182f6';
            
            const { data, error } = await supabaseClient
                .from('products')
                .insert([
                    { goods_no: goodsNo, url: urlInput, is_custom: true }
                ]);

            if (error) {
                if (error.code === '23505') {
                    messageEl.textContent = '이미 추적 목록에 등록되어 있는 상품입니다!';
                    messageEl.style.color = '#f04452';
                    return;
                }
                throw error;
            }
            
            messageEl.textContent = `성공적으로 등록되었습니다! (상품번호: ${goodsNo}) 내일부터 자동으로 가격이 추적됩니다.`;
            messageEl.style.color = '#7fa818';
            document.getElementById('product-url').value = '';

        } catch (error) {
            console.error(error);
            messageEl.textContent = '등록 중 오류가 발생했습니다: ' + error.message;
            messageEl.style.color = '#f04452';
        }
    });
}

/**
 * XSS 방지 HTML Escape
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
