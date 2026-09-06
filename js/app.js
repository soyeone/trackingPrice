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
let currentSortMode = 'rank';      // 'rank' (랭킹순), 'unit_asc' (가성비순), 'price_asc', 'price_desc'
let searchKeyword = '';

/**
 * 초기화 진입점
 */
function boot() {
    // 1. 등록 페이지 로직 (register.html)
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        setupRegisterPage(registerForm);
        return;
    }

    // 2. 대시보드 페이지 로직 (index.html)
    const productListView = document.getElementById('product-list-view');
    if (productListView) {
        initDashboard();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

/**
 * Supabase에서 모든 상품 조회 (1,000개 기본 상한 극복)
 */
async function fetchAllProducts() {
    let all = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
    }
    return all;
}

/**
 * Supabase에서 모든 가격 기록 조회 (1,000개 기본 상한 극복)
 */
async function fetchAllPrices() {
    let all = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
        const { data, error } = await supabaseClient
            .from('prices')
            .select('*')
            .order('date', { ascending: true })
            .range(from, from + batchSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
    }
    return all;
}

/**
 * 뷰 모드 전환 (카테고리별 묶어보기 vs 전체 그리드)
 */
function setViewMode(mode) {
    console.log('[대시보드] 뷰 모드 변경:', mode);
    currentViewMode = mode;
    const btnViewGrouped = document.getElementById('btn-view-grouped');
    const btnViewFlat = document.getElementById('btn-view-flat');

    if (mode === 'grouped') {
        selectedCategory = 'all'; // 묶어보기로 전환 시 전체 카테고리로 초기화하여 모든 그룹을 보여줌
        updateCategoryActivePill('all');
        if (btnViewGrouped) btnViewGrouped.classList.add('active');
        if (btnViewFlat) btnViewFlat.classList.remove('active');
    } else {
        if (btnViewFlat) btnViewFlat.classList.add('active');
        if (btnViewGrouped) btnViewGrouped.classList.remove('active');
    }

    renderView();
}

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
        console.log('[대시보드] Supabase 데이터 조회 시작...');
        // DB에서 전체 제품 및 가격 데이터 페이징 조회
        const [rawProducts, rawPrices] = await Promise.all([
            fetchAllProducts(),
            fetchAllPrices()
        ]);
        console.log(`[대시보드] 데이터 로드 완료 - 상품: ${rawProducts.length}개, 가격: ${rawPrices.length}건`);

        // 가격 데이터를 goods_no 키로 그룹핑
        pricesByGoodsNo = {};
        rawPrices.forEach(p => {
            if (!pricesByGoodsNo[p.goods_no]) {
                pricesByGoodsNo[p.goods_no] = [];
            }
            pricesByGoodsNo[p.goods_no].push(p);
        });

        // 각 제품별 통계, 용량/단위가격, 카테고리/랭킹 파싱
        allProducts = rawProducts.map(prod => {
            const history = pricesByGoodsNo[prod.goods_no] || [];
            let currentPrice = null;
            let minPrice = null;
            let maxPrice = null;
            let lastDate = null;

            if (history.length > 0) {
                const pricesOnly = history.map(h => h.price).filter(p => typeof p === 'number' && !isNaN(p));
                if (pricesOnly.length > 0) {
                    currentPrice = history[history.length - 1].price;
                    lastDate = history[history.length - 1].date;
                    minPrice = Math.min(...pricesOnly);
                    maxPrice = Math.max(...pricesOnly);
                }
            }

            const { category, rank } = extractProductMeta(prod);
            const capInfo = parseCapacity(prod.name);
            const unitPriceInfo = calculateUnitPrice(currentPrice, capInfo);

            return {
                ...prod,
                displayName: prod.name || `올리브영 상품 (${prod.goods_no})`,
                category,
                rank,
                currentPrice,
                minPrice,
                maxPrice,
                lastDate,
                historyCount: history.length,
                capInfo,
                unitPriceInfo
            };
        });

        // 로딩 화면 숨기고 목록 뷰 표시
        if (loadingSpinner) loadingSpinner.style.display = 'none';
        if (productListView) productListView.style.display = 'block';

        // 뷰 모드 토글 버튼 이벤트 바인딩
        if (btnViewGrouped) {
            btnViewGrouped.onclick = () => setViewMode('grouped');
        }

        if (btnViewFlat) {
            btnViewFlat.onclick = () => setViewMode('flat');
        }

        // 정렬 셀렉트 이벤트 바인딩
        const sortSelect = document.getElementById('sort-select');
        if (sortSelect) {
            sortSelect.value = currentSortMode;
            sortSelect.addEventListener('change', (e) => {
                currentSortMode = e.target.value;
                console.log('[대시보드] 정렬 기준 변경:', currentSortMode);
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
            loadingSpinner.innerHTML = `<p style="color:red; padding: 1.5rem; background: #fff0f0; border-radius: 8px;">데이터를 불러오는 중 오류가 발생했습니다: ${escapeHtml(err.message || String(err))}</p>`;
        }
    }
}

/**
 * 상품명에서 정량적 용량/수량(ml, g, 매, 정, 포, 입, 캡슐 등) 추출
 */
function parseCapacity(name) {
    if (!name) return null;

    const isDouble = /(?:1\s*\+\s*1|더블\s*기획|더블기획|듀오\s*기획|듀오기획|2입\s*기획|2개입\s*기획|1더하기1)/i.test(name);

    // 1. ml, l, g, kg 단위 먼저 매칭 (주요 액체/크림 제형 최우선)
    // 1-1. ml/g 합산 표기: 50+50ml, 50ml+50ml, 60g+60g 등
    const addVolumePattern = /([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)?\s*\+\s*([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)(?![a-zA-Z0-9])/i;
    const addVolMatch = name.match(addVolumePattern);
    if (addVolMatch) {
        let v1 = parseFloat(addVolMatch[1]);
        let v2 = parseFloat(addVolMatch[3]);
        let unit = addVolMatch[4].toLowerCase();
        if (unit === 'kg' || addVolMatch[2]?.toLowerCase() === 'kg') {
            v1 = (addVolMatch[2]?.toLowerCase() === 'kg' || (!addVolMatch[2] && unit === 'kg')) ? v1 * 1000 : v1;
            v2 = unit === 'kg' ? v2 * 1000 : v2;
            unit = 'g';
        } else if (unit === 'l' || addVolMatch[2]?.toLowerCase() === 'l') {
            v1 = (addVolMatch[2]?.toLowerCase() === 'l' || (!addVolMatch[2] && unit === 'l')) ? v1 * 1000 : v1;
            v2 = unit === 'l' ? v2 * 1000 : v2;
            unit = 'ml';
        }
        const total = v1 + v2;
        return { total, unit, label: `${total}${unit}` };
    }

    // 1-2. 리필 기획 증정 표기 e.g. "50ml ... (+50ml 리필)"
    const refillPlusPattern = /([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)\b[\s\S]*?\(\s*\+\s*([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)/i;
    const refillMatch = name.match(refillPlusPattern);
    if (refillMatch && refillMatch[2].toLowerCase() === refillMatch[4].toLowerCase()) {
        const v1 = parseFloat(refillMatch[1]);
        const v2 = parseFloat(refillMatch[3]);
        let unit = refillMatch[2].toLowerCase();
        if (unit === 'kg') unit = 'g';
        else if (unit === 'l') unit = 'ml';
        const total = v1 + v2;
        return { total, unit, label: `${total}${unit}` };
    }

    // 1-3. ml/g 곱산 표기: 50ml*2, 30ml x 2개 등
    const mulVolumePattern = /([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)\s*(?:[\*xX]|×)\s*([0-9]+)(?![a-zA-Z0-9])/i;
    const mulVolMatch = name.match(mulVolumePattern);
    if (mulVolMatch) {
        let val = parseFloat(mulVolMatch[1]);
        let unit = mulVolMatch[2].toLowerCase();
        const qty = parseInt(mulVolMatch[3], 10);
        if (unit === 'kg') { val *= 1000; unit = 'g'; }
        else if (unit === 'l') { val *= 1000; unit = 'ml'; }
        const total = val * qty;
        return { total, unit, label: `${total}${unit}` };
    }

    // 1-4. 단일 ml/g 표기: 50ml, 100g, 1.5L 등
    const singleVolPattern = /(?:^|[^\w\.])([0-9]+(?:\.[0-9]+)?)\s*(ml|l|g|kg)(?![a-zA-Z0-9])/i;
    const singleVolMatch = name.match(singleVolPattern);
    if (singleVolMatch) {
        let val = parseFloat(singleVolMatch[1]);
        let unit = singleVolMatch[2].toLowerCase();
        if (unit === 'kg') { val *= 1000; unit = 'g'; }
        else if (unit === 'l') { val *= 1000; unit = 'ml'; }
        let total = isDouble ? val * 2 : val;
        return { total, unit, label: `${total}${unit}` };
    }

    // 2. 수량/매수/정/포/개 단위 매칭 (마스크팩, 토너패드, 영양제 등)
    // 2-1. 매/개 합산 표기: 100+100매, 70매+70매
    const addItemPattern = /([0-9]+)\s*(매|개|정|포)?\s*\+\s*([0-9]+)\s*(매|개|정|포|입)(?![가-힣a-zA-Z0-9])/i;
    const addItemMatch = name.match(addItemPattern);
    if (addItemMatch) {
        const v1 = parseInt(addItemMatch[1], 10);
        const v2 = parseInt(addItemMatch[3], 10);
        let unit = addItemMatch[4];
        if (unit === '입') unit = '개';
        const total = v1 + v2;
        return { total, unit, label: `${total}${unit}` };
    }

    // 2-2. 매/개 곱산 표기: 100매x2개입, 60정*2
    const mulItemPattern = /([0-9]+)\s*(매|개|정|포|캡슐)\s*(?:[\*xX]|×)\s*([0-9]+)(?:개|매|입)?(?![가-힣a-zA-Z0-9])/i;
    const mulItemMatch = name.match(mulItemPattern);
    if (mulItemMatch) {
        const val = parseInt(mulItemMatch[1], 10);
        let unit = mulItemMatch[2];
        const qty = parseInt(mulItemMatch[3], 10);
        const total = val * qty;
        return { total, unit, label: `${total}${unit}` };
    }

    // 2-3. 단일 매/개/정/포/입/캡슐 표기 (뒤에 다른 한글이 붙지 않아야 함: 포밍, 개선, 정품 등 제외)
    const singleItemPattern = /(?:^|[^0-9])([0-9]+)\s*(?:(개입|매입)|(매|개|정|포|캡슐|입))(?![가-힣a-zA-Z0-9])/i;
    const singleItemMatch = name.match(singleItemPattern);
    if (singleItemMatch) {
        const val = parseInt(singleItemMatch[1], 10);
        let rawUnit = singleItemMatch[2] || singleItemMatch[3];
        let unit = rawUnit.replace('입', '') || '개';
        if (rawUnit === '개입') unit = '개';
        if (rawUnit === '매입') unit = '매';
        let total = isDouble ? val * 2 : val;
        return { total, unit, label: `${total}${unit}` };
    }

    return null;
}

/**
 * 용량 정보 및 현재 가격을 바탕으로 단위 가격 계산 (10ml당, 10g당, 1매당, 개당 등)
 */
function calculateUnitPrice(price, capInfo) {
    if (!price || !capInfo || !capInfo.total || capInfo.total <= 0) return null;

    const { total, unit } = capInfo;

    if (unit === 'ml') {
        const per10ml = Math.round((price / total) * 10);
        return {
            unitLabel: '10ml당',
            unitPrice: per10ml,
            display: `10ml당 ${per10ml.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}ml`
        };
    } else if (unit === 'g') {
        const per10g = Math.round((price / total) * 10);
        return {
            unitLabel: '10g당',
            unitPrice: per10g,
            display: `10g당 ${per10g.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}g`
        };
    } else if (unit === '매') {
        const perItem = Math.round(price / total);
        return {
            unitLabel: '1매당',
            unitPrice: perItem,
            display: `1매당 ${perItem.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}매`
        };
    } else if (unit === '정' || unit === '캡슐') {
        const perItem = Math.round(price / total);
        return {
            unitLabel: '1정당',
            unitPrice: perItem,
            display: `1정당 ${perItem.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}정`
        };
    } else if (unit === '포') {
        const perItem = Math.round(price / total);
        return {
            unitLabel: '1포당',
            unitPrice: perItem,
            display: `1포당 ${perItem.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}포`
        };
    } else if (unit === '개' || unit === '입') {
        const perItem = Math.round(price / total);
        return {
            unitLabel: '개당',
            unitPrice: perItem,
            display: `개당 ${perItem.toLocaleString()}원`,
            capacityLabel: `${total.toLocaleString()}개`
        };
    }

    return null;
}

/**
 * 정렬 기준에 따라 제품 리스트 정렬
 */
function sortProducts(list, sortMode) {
    return [...list].sort((a, b) => {
        if (sortMode === 'unit_asc') {
            // 가성비순: 단위 가격 정보가 있는 제품 우선, 단위가격 낮은 순
            const uA = a.unitPriceInfo ? a.unitPriceInfo.unitPrice : 999999999;
            const uB = b.unitPriceInfo ? b.unitPriceInfo.unitPrice : 999999999;
            if (uA !== uB) return uA - uB;
            return (a.rank || 9999) - (b.rank || 9999);
        } else if (sortMode === 'price_asc') {
            const pA = (a.currentPrice !== null && a.currentPrice !== undefined) ? a.currentPrice : 999999999;
            const pB = (b.currentPrice !== null && b.currentPrice !== undefined) ? b.currentPrice : 999999999;
            if (pA !== pB) return pA - pB;
            return (a.rank || 9999) - (b.rank || 9999);
        } else if (sortMode === 'price_desc') {
            const pA = (a.currentPrice !== null && a.currentPrice !== undefined) ? a.currentPrice : 0;
            const pB = (b.currentPrice !== null && b.currentPrice !== undefined) ? b.currentPrice : 0;
            if (pA !== pB) return pB - pA;
            return (a.rank || 9999) - (b.rank || 9999);
        } else {
            // 기본 랭킹순
            return (a.rank || 9999) - (b.rank || 9999);
        }
    });
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
 * 카테고리 탭 활성화 상태 UI 동기화
 */
function updateCategoryActivePill(catName) {
    const pills = document.querySelectorAll('.cat-pill');
    pills.forEach(pill => pill.classList.remove('active'));

    const activePill = Array.from(pills).find(pill => {
        if (catName === 'all' && pill.textContent.includes('전체')) return true;
        return pill.textContent.includes(catName);
    });
    if (activePill) activePill.classList.add('active');
}

/**
 * 카테고리 선택 처리
 */
function selectCategory(catName) {
    console.log('[대시보드] 카테고리 선택:', catName);
    selectedCategory = catName;
    updateCategoryActivePill(catName);

    const btnViewGrouped = document.getElementById('btn-view-grouped');
    const btnViewFlat = document.getElementById('btn-view-flat');

    if (catName !== 'all') {
        // 개별 카테고리를 선택했을 때는 해당 카테고리의 상품 그리드를 보여줌
        if (btnViewGrouped) btnViewGrouped.classList.remove('active');
        if (btnViewFlat) btnViewFlat.classList.add('active');
    } else {
        // '전체' 탭을 선택한 경우: 현재 뷰 모드에 맞춰 버튼 활성화
        if (currentViewMode === 'grouped') {
            if (btnViewGrouped) btnViewGrouped.classList.add('active');
            if (btnViewFlat) btnViewFlat.classList.remove('active');
        } else {
            if (btnViewFlat) btnViewFlat.classList.add('active');
            if (btnViewGrouped) btnViewGrouped.classList.remove('active');
        }
    }

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

    if (!groupedContainer || !flatGrid) {
        console.error('[대시보드] 컨테이너 요소를 찾을 수 없습니다.');
        return;
    }

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
        groupedContainer.style.display = 'none';
        flatGrid.style.display = 'none';
        if (noResults) noResults.style.display = 'block';
        return;
    }

    if (noResults) noResults.style.display = 'none';

    // 묶어보기 조건: selectedCategory가 'all'이고 currentViewMode가 'grouped'일 때
    const isGroupedView = (selectedCategory === 'all' && currentViewMode === 'grouped');

    if (isGroupedView) {
        flatGrid.style.display = 'none';
        groupedContainer.style.display = 'flex';
        renderCategoryGroupedView(groupedContainer, filtered);
    } else {
        // 단일 카테고리 뷰 또는 전체 그리드 뷰
        groupedContainer.style.display = 'none';
        flatGrid.style.display = 'grid';

        let categoryFiltered = filtered;
        if (selectedCategory === '직접 등록') {
            categoryFiltered = filtered.filter(p => p.is_custom);
        } else if (selectedCategory !== 'all') {
            categoryFiltered = filtered.filter(p => p.category === selectedCategory);
        }

        // 선택된 정렬 기준(랭킹순, 가성비순, 가격순) 적용
        const sortedProducts = sortProducts(categoryFiltered, currentSortMode);

        renderProductGrid(flatGrid, sortedProducts);
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

    // 1. CATEGORY_LIST 순서대로 섹션 생성
    CATEGORY_LIST.forEach(catMeta => {
        const catName = catMeta.name;
        const list = groups[catName];
        if (!list || list.length === 0) return;

        // 선택된 정렬 기준 적용
        const sortedList = sortProducts(list, currentSortMode);

        const section = document.createElement('section');
        section.className = 'category-section';

        section.innerHTML = `
            <div class="category-section-header">
                <div class="cat-header-left">
                    <span class="cat-header-icon">${catMeta.icon}</span>
                    <h2 class="cat-header-title">${escapeHtml(catName)}</h2>
                    <span class="cat-header-badge">${sortedList.length}개 상품</span>
                </div>
                <button type="button" class="cat-view-all-btn" data-cat="${escapeHtml(catName)}">
                    ${escapeHtml(catName)} 전체 100위 보기 →
                </button>
            </div>
            <div class="product-grid">
                <!-- 이 카테고리의 카드들 -->
            </div>
        `;

        // 상위 8개 초과 상품이 있으면 하단 더보기 버튼 추가
        const isSearching = !!searchKeyword;
        const displayList = isSearching ? sortedList : sortedList.slice(0, 8);

        if (!isSearching && sortedList.length > 8) {
            const footerDiv = document.createElement('div');
            footerDiv.className = 'cat-section-footer';
            footerDiv.innerHTML = `
                <button type="button" class="cat-footer-more-btn">
                    ✨ ${escapeHtml(catName)} 랭킹 TOP 100 전체보기 (${sortedList.length}개 상품) →
                </button>
            `;
            const footerBtn = footerDiv.querySelector('button');
            if (footerBtn) {
                footerBtn.addEventListener('click', () => {
                    selectCategory(catName);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                });
            }
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

        const sectionGrid = section.querySelector('.product-grid');
        renderProductGrid(sectionGrid, displayList);
    });

    // 2. 직접 등록 상품 섹션 (있는 경우)
    const customList = groups['직접 등록'];
    if (customList && customList.length > 0) {
        const sortedCustomList = sortProducts(customList, currentSortMode);
        const section = document.createElement('section');
        section.className = 'category-section';
        section.innerHTML = `
            <div class="category-section-header">
                <div class="cat-header-left">
                    <span class="cat-header-icon">📌</span>
                    <h2 class="cat-header-title">직접 등록 상품</h2>
                    <span class="cat-header-badge">${sortedCustomList.length}개 상품</span>
                </div>
                <button type="button" class="cat-view-all-btn">
                    직접 등록 상품 전체보기 →
                </button>
            </div>
            <div class="product-grid"></div>
        `;
        const viewAllBtn = section.querySelector('.cat-view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                selectCategory('직접 등록');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
        container.appendChild(section);
        const sectionGrid = section.querySelector('.product-grid');
        renderProductGrid(sectionGrid, sortedCustomList);
    }

    // 3. 기타 카테고리 (CATEGORY_LIST 및 '직접 등록' 외에 상품이 있는 경우)
    Object.keys(groups).forEach(catName => {
        if (CATEGORY_LIST.some(c => c.name === catName) || catName === '직접 등록') return;
        const otherList = groups[catName];
        if (!otherList || otherList.length === 0) return;

        const sortedOtherList = sortProducts(otherList, currentSortMode);
        const section = document.createElement('section');
        section.className = 'category-section';
        section.innerHTML = `
            <div class="category-section-header">
                <div class="cat-header-left">
                    <span class="cat-header-icon">🏷️</span>
                    <h2 class="cat-header-title">${escapeHtml(catName)}</h2>
                    <span class="cat-header-badge">${sortedOtherList.length}개 상품</span>
                </div>
                <button type="button" class="cat-view-all-btn">
                    ${escapeHtml(catName)} 전체보기 →
                </button>
            </div>
            <div class="product-grid"></div>
        `;
        const viewAllBtn = section.querySelector('.cat-view-all-btn');
        if (viewAllBtn) {
            viewAllBtn.addEventListener('click', () => {
                selectCategory(catName);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
        container.appendChild(section);
        const sectionGrid = section.querySelector('.product-grid');
        renderProductGrid(sectionGrid, sortedOtherList);
    });
}

/**
 * 제품 그리드 요소 채우기
 */
function renderProductGrid(targetGrid, products) {
    if (!targetGrid) return;
    targetGrid.innerHTML = '';

    if (!products || products.length === 0) return;

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

        // 가격 및 단위 가격 표시
        let priceHtml = '';
        if (prod.currentPrice !== null && prod.currentPrice !== undefined && !isNaN(prod.currentPrice)) {
            let unitPriceHtml = '';
            if (prod.unitPriceInfo) {
                unitPriceHtml = `
                    <div class="card-unit-price-row" title="단위 용량당 환산 가격">
                        <div class="unit-price-main">
                            <span class="unit-tag">${escapeHtml(prod.unitPriceInfo.unitLabel)}</span>
                            <span class="unit-val">${prod.unitPriceInfo.unitPrice.toLocaleString()}원</span>
                        </div>
                        <span class="capacity-total-tag">총 ${escapeHtml(prod.unitPriceInfo.capacityLabel)}</span>
                    </div>
                `;
            }

            priceHtml = `
                <div class="card-price-section">
                    <div class="card-price-row">
                        <span class="card-price-label">현재 가격</span>
                        <div class="card-price">${Number(prod.currentPrice).toLocaleString()}<span>원</span></div>
                    </div>
                    ${unitPriceHtml}
                </div>
            `;
        } else {
            priceHtml = `
                <div class="card-price-section">
                    <div class="card-price-row">
                        <span class="card-price-label">가격 정보</span>
                        <span style="font-size:0.85rem; color:#8b95a1;">수집 대기 중</span>
                    </div>
                </div>
            `;
        }

        const safeTitle = escapeHtml(prod.displayName || `상품 (${prod.goods_no})`);

        card.innerHTML = `
            <div>
                <div class="card-badges-row">
                    ${rankBadgeHtml}
                    ${categoryBadgeHtml}
                </div>
                <h2 class="card-title" title="${safeTitle}">${safeTitle}</h2>
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
    const unitPriceEl = document.getElementById('metric-unit-price');
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

        if (product.unitPriceInfo) {
            if (unitPriceEl) {
                unitPriceEl.style.display = 'inline-block';
                unitPriceEl.textContent = `💡 ${product.unitPriceInfo.unitLabel} ${product.unitPriceInfo.unitPrice.toLocaleString()}원 (총 ${product.unitPriceInfo.capacityLabel})`;
            }
        } else {
            if (unitPriceEl) unitPriceEl.style.display = 'none';
        }

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
        if (unitPriceEl) unitPriceEl.style.display = 'none';
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
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// 개발 및 디버그용 전역 접근자
window.trackingPriceApp = {
    setViewMode,
    selectCategory,
    renderView,
    initDashboard,
    getAllProducts: () => allProducts
};

