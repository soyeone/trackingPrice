// Supabase 설정
const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

// Supabase 클라이언트 초기화
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 주요 카테고리 메타데이터
const CATEGORY_LIST = [
    { id: '10000010001', name: '스킨케어', icon: '🧴' },
    { id: '10000010009', name: '마스크팩', icon: '🧖' },
    { id: '10000010010', name: '클렌징', icon: '🫧' },
    { id: '10000010011', name: '선케어', icon: '☀️' },
    { id: '10000010002', name: '메이크업', icon: '💄' },
    { id: '10000010008', name: '더모 코스메틱', icon: '🧪' },
    { id: '10000010004', name: '헤어케어', icon: '💇' },
    { id: '10000010003', name: '바디케어', icon: '🛁' },
    { id: '10000010005', name: '향수/디퓨저', icon: '💐' },
    { id: '10000020001', name: '건강식품', icon: '💊' },
    { id: '10000020003', name: '구강용품', icon: '🪥' },
    { id: '10000010007', name: '맨즈에딧', icon: '🧔' }
];

// 전역 상태
let allProducts = [];
let pricesByGoodsNo = {};
let currentChart = null;
let selectedCategory = 'all';     // 'all' 또는 특정 카테고리명
let currentViewMode = 'grouped';   // 'grouped' (카테고리별 묶어보기, 기본값) 또는 'flat' (그리드)
let searchKeyword = '';

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
    const btnViewGrouped = document.getElementById('btn-view-grouped');
    const btnViewFlat = document.getElementById('btn-view-flat');

    try {
        // DB에서 제품 목록 및 가격 목록 동시 조회 (최대 3000건 지원)
        const [productsRes, pricesRes] = await Promise.all([
            supabaseClient.from('products').select('*').limit(3000),
            supabaseClient.from('prices').select('*').order('date', { ascending: true }).limit(10000)
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

        // 각 제품별 통계 및 카테고리/랭킹 파싱
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

            const { category, rank } = extractProductMeta(prod);

            return {
                ...prod,
                displayName: prod.name || `올리브영 상품 (${prod.goods_no})`,
                category,
                rank,
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

        // 뷰 모드 토글 이벤트 등록
        if (btnViewGrouped) {
            btnViewGrouped.addEventListener('click', () => {
                currentViewMode = 'grouped';
                btnViewGrouped.classList.add('active');
                if (btnViewFlat) btnViewFlat.classList.remove('active');
                renderView();
            });
        }

        if (btnViewFlat) {
            btnViewFlat.addEventListener('click', () => {
                currentViewMode = 'flat';
                btnViewFlat.classList.add('active');
                if (btnViewGrouped) btnViewGrouped.classList.remove('active');
                renderView();
            });
        }

        // 검색 이벤트 리스너 등록
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchKeyword = e.target.value.trim().toLowerCase();
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = searchKeyword ? 'flex' : 'none';
                }
                renderView();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                searchInput.value = '';
                searchKeyword = '';
                clearSearchBtn.style.display = 'none';
                renderView();
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

        // 카테고리 탭 렌더링 및 초기 뷰 출력
        renderCategoryFilterBar();
        handleUrlRoute();

    } catch (err) {
        console.error('대시보드 데이터 로드 오류:', err);
        if (loadingSpinner) {
            loadingSpinner.innerHTML = `<p style="color:red;">데이터를 불러오는 중 오류가 발생했습니다: ${err.message}</p>`;
        }
    }
}

/**
 * 상품 객체에서 카테고리와 랭킹 정보를 추출
 */
function extractProductMeta(prod) {
    let category = prod.category || '';
    let rank = prod.rank || null;

    if (prod.url) {
        try {
            const urlObj = new URL(prod.url);
            const catNameParam = urlObj.searchParams.get('catName') || urlObj.searchParams.get('category');
            if (catNameParam) {
                category = decodeURIComponent(catNameParam);
            } else {
                const dispCatNo = urlObj.searchParams.get('dispCatNo') || urlObj.searchParams.get('fltDispCatNo');
                const matched = CATEGORY_LIST.find(c => c.id === dispCatNo);
                if (matched) category = matched.name;
            }

            const rankParam = urlObj.searchParams.get('rank');
            if (rankParam && !isNaN(parseInt(rankParam, 10))) {
                rank = parseInt(rankParam, 10);
            }
        } catch (e) {}
    }

    if (!category) {
        category = prod.is_custom ? '직접 등록' : '기타';
    }

    return { category, rank };
}

/**
 * 카테고리 필터 탭 바 동적 렌더링
 */
function renderCategoryFilterBar() {
    const filterBar = document.getElementById('category-filter-bar');
    if (!filterBar) return;
    filterBar.innerHTML = '';

    // 카테고리별 상품 수 계산
    const categoryCounts = {};
    allProducts.forEach(p => {
        categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
    });

    // 1. '전체' 탭
    const allPill = document.createElement('button');
    allPill.type = 'button';
    allPill.className = `cat-pill ${selectedCategory === 'all' ? 'active' : ''}`;
    allPill.innerHTML = `🌟 전체 <span class="cat-count">${allProducts.length}</span>`;
    allPill.addEventListener('click', () => {
        selectCategory('all');
    });
    filterBar.appendChild(allPill);

    // 2. 주요 카테고리 탭 목록
    CATEGORY_LIST.forEach(cat => {
        const count = categoryCounts[cat.name] || 0;
        if (count === 0 && !allProducts.some(p => p.category === cat.name)) return;

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `cat-pill ${selectedCategory === cat.name ? 'active' : ''}`;
        pill.innerHTML = `${cat.icon} ${cat.name} <span class="cat-count">${count}</span>`;
        pill.addEventListener('click', () => {
            selectCategory(cat.name);
        });
        filterBar.appendChild(pill);
    });

    // 3. '직접 등록' 탭 (해당 상품이 있는 경우)
    const customCount = allProducts.filter(p => p.is_custom).length;
    if (customCount > 0) {
        const customPill = document.createElement('button');
        customPill.type = 'button';
        customPill.className = `cat-pill ${selectedCategory === '직접 등록' ? 'active' : ''}`;
        customPill.innerHTML = `📌 직접 등록 <span class="cat-count">${customCount}</span>`;
        customPill.addEventListener('click', () => {
            selectCategory('직접 등록');
        });
        filterBar.appendChild(customPill);
    }
}

/**
 * 카테고리 선택 처리
 */
function selectCategory(catName) {
    selectedCategory = catName;

    // 탭 활성화 상태 동기화
    const pills = document.querySelectorAll('.cat-pill');
    pills.forEach(pill => pill.classList.remove('active'));

    const activePill = Array.from(pills).find(pill => {
        if (catName === 'all' && pill.textContent.includes('전체')) return true;
        return pill.textContent.includes(catName);
    });
    if (activePill) activePill.classList.add('active');

    renderView();
}

/**
 * 현재 조건(검색어, 카테고리, 뷰모드)에 따라 화면 렌더링
 */
function renderView() {
    const groupedContainer = document.getElementById('category-grouped-container');
    const flatGrid = document.getElementById('product-grid');
    const noResults = document.getElementById('no-results-msg');
    const searchStats = document.getElementById('search-stats');

    // 검색어 필터링
    let filtered = allProducts;
    if (searchKeyword) {
        filtered = allProducts.filter(p =>
            (p.displayName && p.displayName.toLowerCase().includes(searchKeyword)) ||
            (p.goods_no && p.goods_no.toLowerCase().includes(searchKeyword)) ||
            (p.category && p.category.toLowerCase().includes(searchKeyword))
        );
    }

    if (searchStats) {
        const catLabel = selectedCategory === 'all' ? '전체 카테고리' : `'${selectedCategory}'`;
        searchStats.textContent = `${catLabel} 총 ${filtered.length}개의 추적 제품이 있습니다.`;
    }

    if (filtered.length === 0) {
        if (groupedContainer) groupedContainer.style.display = 'none';
        if (flatGrid) flatGrid.style.display = 'none';
        if (noResults) noResults.style.display = 'block';
        return;
    }

    if (noResults) noResults.style.display = 'none';

    // 특정 카테고리가 선택되었거나, 전체 그리드 모드인 경우
    if (selectedCategory !== 'all' || currentViewMode === 'flat') {
        if (groupedContainer) groupedContainer.style.display = 'none';
        if (flatGrid) flatGrid.style.display = 'grid';

        let categoryFiltered = filtered;
        if (selectedCategory === '직접 등록') {
            categoryFiltered = filtered.filter(p => p.is_custom);
        } else if (selectedCategory !== 'all') {
            categoryFiltered = filtered.filter(p => p.category === selectedCategory);
        }

        // 랭킹 순 정렬
        categoryFiltered.sort((a, b) => {
            const rankA = a.rank || 9999;
            const rankB = b.rank || 9999;
            return rankA - rankB;
        });

        renderProductGrid(flatGrid, categoryFiltered);
    } else {
        // 기본 모드: 카테고리별 묶어보기 뷰
        if (flatGrid) flatGrid.style.display = 'none';
        if (groupedContainer) groupedContainer.style.display = 'flex';

        renderCategoryGroupedView(groupedContainer, filtered);
    }
}

/**
 * 카테고리별 묶어보기 섹션 렌더링
 */
function renderCategoryGroupedView(container, products) {
    container.innerHTML = '';

    // 존재하는 카테고리별 그룹화
    const groups = {};
    products.forEach(p => {
        const cat = p.category || '기타';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(p);
    });

    // CATEGORY_LIST 순서대로 섹션 생성
    CATEGORY_LIST.forEach(catMeta => {
        const catName = catMeta.name;
        const list = groups[catName];
        if (!list || list.length === 0) return;

        // 랭킹 순 정렬
        list.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

        const section = document.createElement('section');
        section.className = 'category-section';

        section.innerHTML = `
            <div class="category-section-header">
                <div class="cat-header-left">
                    <span class="cat-header-icon">${catMeta.icon}</span>
                    <h2 class="cat-header-title">${catName}</h2>
                    <span class="cat-header-badge">${list.length}개 상품</span>
                </div>
                <button type="button" class="cat-view-all-btn" data-cat="${catName}">
                    ${catName} 전체 100위 보기 →
                </button>
            </div>
            <div class="product-grid">
                <!-- 이 카테고리의 카드들 -->
            </div>
        `;

        const sectionGrid = section.querySelector('.product-grid');
        
        // 검색 중이면 전체, 평상시에는 상위 8개 프리뷰
        const isSearching = !!searchKeyword;
        const displayList = isSearching ? list : list.slice(0, 8);
        renderProductGrid(sectionGrid, displayList);

        // 상위 8개 초과 상품이 있으면 하단 더보기 버튼 추가
        if (!isSearching && list.length > 8) {
            const footerDiv = document.createElement('div');
            footerDiv.className = 'cat-section-footer';
            footerDiv.innerHTML = `
                <button type="button" class="cat-footer-more-btn">
                    ✨ ${catName} 랭킹 TOP 100 전체보기 (${list.length}개 상품) →
                </button>
            `;
            footerDiv.querySelector('button').addEventListener('click', () => {
                selectCategory(catName);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            section.appendChild(footerDiv);
        }

        const viewAllBtn = section.querySelector('.cat-view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                selectCategory(catName);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        container.appendChild(section);
    });

    // 직접 등록 상품 섹션 (있는 경우)
    const customList = groups['직접 등록'];
    if (customList && customList.length > 0) {
        const section = document.createElement('section');
        section.className = 'category-section';
        section.innerHTML = `
            <div class="category-section-header">
                <div class="cat-header-left">
                    <span class="cat-header-icon">📌</span>
                    <h2 class="cat-header-title">직접 등록 상품</h2>
                    <span class="cat-header-badge">${customList.length}개 상품</span>
                </div>
                <button type="button" class="cat-view-all-btn">
                    직접 등록 상품 전체보기 →
                </button>
            </div>
            <div class="product-grid"></div>
        `;
        const sectionGrid = section.querySelector('.product-grid');
        renderProductGrid(sectionGrid, customList);
        section.querySelector('.cat-view-all-btn').addEventListener('click', () => {
            selectCategory('직접 등록');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        container.appendChild(section);
    }
}

/**
 * 제품 그리드 요소 채우기
 */
function renderProductGrid(targetGrid, products) {
    targetGrid.innerHTML = '';

    products.forEach(prod => {
        const card = document.createElement('div');
        card.className = 'product-card';

        // 랭킹 배지 생성
        let rankBadgeHtml = '';
        if (prod.is_custom) {
            rankBadgeHtml = `<span class="badge-custom">📌 직접 등록</span>`;
        } else if (prod.rank) {
            if (prod.rank === 1) {
                rankBadgeHtml = `<span class="badge-rank badge-rank-1">👑 1위</span>`;
            } else if (prod.rank === 2) {
                rankBadgeHtml = `<span class="badge-rank badge-rank-2">🥈 2위</span>`;
            } else if (prod.rank === 3) {
                rankBadgeHtml = `<span class="badge-rank badge-rank-3">🥉 3위</span>`;
            } else {
                rankBadgeHtml = `<span class="badge-rank badge-rank-normal">${prod.rank}위</span>`;
            }
        }

        // 카테고리 배지
        const categoryBadgeHtml = prod.category ? `<span class="badge-category">${escapeHtml(prod.category)}</span>` : '';

        // 가격 표시
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
                <div class="card-badges-row">
                    ${rankBadgeHtml}
                    ${categoryBadgeHtml}
                </div>
                <h2 class="card-title" title="${escapeHtml(prod.displayName)}">${escapeHtml(prod.displayName)}</h2>
            </div>
            <div>
                ${priceHtml}
                <div class="card-cta">📊 가격 추이 및 상세 보기 →</div>
            </div>
        `;

        card.addEventListener('click', () => {
            window.location.hash = `goodsNo=${prod.goods_no}`;
        });

        targetGrid.appendChild(card);
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

    renderView();
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        const rankText = product.rank ? ` • ${product.rank}위` : '';
        customBadge.textContent = product.is_custom ? '직접 등록 상품' : `${product.category} 랭킹${rankText}`;
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

    const sortedHistory = [...history].reverse();

    sortedHistory.forEach((item, index) => {
        const tr = document.createElement('tr');

        let diffHtml = '<span class="diff-same">-</span>';
        let statusHtml = '<span style="color:#8b95a1;">동일</span>';

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
 * 등록 페이지 폼 처리 (register.html)
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
