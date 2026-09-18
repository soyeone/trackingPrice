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
    { id: '10000060002', name: '맨즈에딧', icon: '🧔' }
];

// 전역 상태
let allProducts = [];
let pricesByGoodsNo = {};
let currentChart = null;
let currentChartPeriod = 'daily';   // 'daily' (일자별) | 'monthly' (월별) | 'yearly' (연별)
let currentChartMetric = 'min';     // 'min' (최저가) | 'avg' (평균가)
let currentTableMode = 'grouped';   // 'grouped' (구간별 묶어보기, 기본값) | 'all' (전체 일자별)
let currentDetailHistory = [];      // 현재 상세 뷰의 가격 이력 데이터
let selectedCategory = 'all';     // 'all' 또는 특정 카테고리명
let currentViewMode = 'grouped';   // 'grouped' (카테고리별 묶어보기, 기본값) 또는 'flat' (그리드)
let currentSortMode = 'rank';      // 'rank' (랭킹순), 'unit_asc' (가성비순), 'price_asc', 'price_desc'
let searchKeyword = '';
let hideDiscontinued = true;       // 판매종료 상품 목록 숨김 여부 (기본 true)

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

            const { category, rank, catRanks } = extractProductMeta(prod);
            const capInfo = parseCapacity(prod.name);
            const unitPriceInfo = calculateUnitPrice(currentPrice, capInfo);

            // 판매종료 또는 링크를 찾을 수 없는 제품 판별
            const is_link_broken = !prod.url || prod.url.trim() === '' || prod.url.includes('notFound=true') || prod.url.includes('status=discontinued');
            const is_discontinued = !!(
                is_link_broken ||
                (prod.name && prod.name.includes('[판매종료]')) ||
                (currentPrice === null || currentPrice === undefined || currentPrice <= 0)
            );

            // 판매종료/단종 상품은 과거 랭킹 잔여값 무시 및 랭킹 태그 완전 제거
            const finalRank = is_discontinued ? null : rank;
            const finalCatRanks = is_discontinued ? {} : catRanks;

            let displayName = (prod.name && prod.name !== prod.goods_no) ? prod.name : `올리브영 상품 (${prod.goods_no})`;
            if (is_discontinued && !displayName.includes('[판매종료]')) {
                displayName = `[판매종료] ${displayName}`;
            }

            return {
                ...prod,
                displayName,
                category,
                rank: finalRank,
                catRanks: finalCatRanks,
                is_discontinued,
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

        // 판매종료 숨기기 토글 체크박스 이벤트 바인딩
        const toggleHideDisc = document.getElementById('toggle-hide-discontinued');
        if (toggleHideDisc) {
            toggleHideDisc.checked = hideDiscontinued;
            toggleHideDisc.addEventListener('change', (e) => {
                hideDiscontinued = e.target.checked;
                console.log('[대시보드] 판매종료 상품 숨김 상태 변경:', hideDiscontinued);
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

        // 차트 컨트롤 (일자별/월별/연별, 최저가/평균가) 리스너 등록
        setupChartControls();

        // 가격 기록 테이블 컨트롤 (구간별 묶어보기/전체 일자별) 리스너 등록
        setupTableControls();

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
 * - 1순위: 정상 판매 상품 vs 판매종료/링크불가 제품 (판매종료/링크불가 제품은 무조건 목록의 맨 끝으로 정렬)
 * - 2순위: 정상 판매 상품 내부 정렬 (랭킹순: 현재 랭킹 1~100위 우선 오름차순 -> 랭킹 밖 상품, 가성비순, 가격순)
 * - 3순위: 맨 끝 판매종료/링크불가 제품 내부 정렬 (랭킹순 -> 상품명 가나다순)
 */
function sortProducts(list, sortMode) {
    return [...list].sort((a, b) => {
        const aBroken = !!(a.is_discontinued || !a.currentPrice || a.currentPrice <= 0);
        const bBroken = !!(b.is_discontinued || !b.currentPrice || b.currentPrice <= 0);

        // 1. 정상 판매 상품 vs 판매종료/링크불가 상품 분리
        // broken 상품은 항상 뒤(+1)로 이동하여 가장 끝에 정렬됨
        if (aBroken !== bBroken) {
            return aBroken ? 1 : -1;
        }

        // 2. 둘 다 판매종료/링크불가 상품인 경우 (가장 끝 그룹 내부)
        if (aBroken && bBroken) {
            const rA = (a.rank && a.rank >= 1 && a.rank <= 100) ? a.rank : 9999;
            const rB = (b.rank && b.rank >= 1 && b.rank <= 100) ? b.rank : 9999;
            if (rA !== rB) return rA - rB;
            return (a.displayName || '').localeCompare(b.displayName || '', 'ko');
        }

        // 3. 둘 다 정상 판매 상품인 경우:
        if (sortMode === 'unit_asc') {
            // 가성비순: 단위가격 낮은 순 -> 동률 시 랭킹순
            const uA = a.unitPriceInfo ? a.unitPriceInfo.unitPrice : 999999999;
            const uB = b.unitPriceInfo ? b.unitPriceInfo.unitPrice : 999999999;
            if (uA !== uB) return uA - uB;
            return (a.rank || 9999) - (b.rank || 9999);
        } else if (sortMode === 'price_asc') {
            // 가격 낮은순 -> 동률 시 랭킹순
            const pA = (a.currentPrice !== null && a.currentPrice !== undefined) ? a.currentPrice : 999999999;
            const pB = (b.currentPrice !== null && b.currentPrice !== undefined) ? b.currentPrice : 999999999;
            if (pA !== pB) return pA - pB;
            return (a.rank || 9999) - (b.rank || 9999);
        } else if (sortMode === 'price_desc') {
            // 가격 높은순 -> 동률 시 랭킹순
            const pA = (a.currentPrice !== null && a.currentPrice !== undefined) ? a.currentPrice : 0;
            const pB = (b.currentPrice !== null && b.currentPrice !== undefined) ? b.currentPrice : 0;
            if (pA !== pB) return pB - pA;
            return (a.rank || 9999) - (b.rank || 9999);
        } else {
            // 기본: 현재 올리브영 랭킹순 ('rank')
            // 현재 랭킹 1~100위 상품을 1위부터 100위까지 순서대로 배치
            const rA = (a.rank && a.rank >= 1 && a.rank <= 100) ? a.rank : 9999;
            const rB = (b.rank && b.rank >= 1 && b.rank <= 100) ? b.rank : 9999;
            if (rA !== rB) return rA - rB;
            // 둘 다 랭킹 밖 상품인 경우 상품명 순
            return (a.displayName || '').localeCompare(b.displayName || '', 'ko');
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

            // 다중 카테고리 랭킹 파싱 (catRanks=스킨케어:5|더모 코스메틱:2)
            let catRanks = {};
            const catRanksParam = urlObj.searchParams.get('catRanks');
            if (catRanksParam) {
                try {
                    const decoded = decodeURIComponent(catRanksParam);
                    const pairs = decoded.split('|');
                    for (const pair of pairs) {
                        const [cName, cRank] = pair.split(':');
                        if (cName && cRank && !isNaN(parseInt(cRank, 10))) {
                            catRanks[cName.trim()] = parseInt(cRank, 10);
                        }
                    }
                } catch (e) {}
            }

            // catRanks가 비어있고 대표 카테고리와 랭킹이 있다면 기본값 설정
            if (category && rank && Object.keys(catRanks).length === 0) {
                catRanks[category] = rank;
            }

            // 판매종료 상품인 경우 과거 rank 및 catRanks 파라미터 무시
            if (urlObj.searchParams.get('status') === 'discontinued' || (prod.name && prod.name.includes('[판매종료]'))) {
                rank = null;
                catRanks = {};
            }

            if (!category) {
                category = prod.is_custom ? '직접 등록' : '기타';
            }

            return { category, rank, catRanks };
        } catch (e) {}
    }

    if (!category) {
        category = prod.is_custom ? '직접 등록' : '기타';
    }

    return { category, rank, catRanks: (category && rank) ? { [category]: rank } : {} };
}

/**
 * 카테고리 필터 탭 바 동적 렌더링
 */
function renderCategoryFilterBar() {
    const filterBar = document.getElementById('category-filter-bar');
    if (!filterBar) return;
    filterBar.innerHTML = '';

    // 카테고리별 상품 수 계산 (다중 카테고리 포함)
    const categoryCounts = {};
    allProducts.forEach(p => {
        if (p.is_discontinued && hideDiscontinued) return;
        if (p.catRanks && Object.keys(p.catRanks).length > 0) {
            Object.keys(p.catRanks).forEach(cName => {
                categoryCounts[cName] = (categoryCounts[cName] || 0) + 1;
            });
        } else if (p.category) {
            categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
        }
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

    // 판매종료 필터링 및 검색어 필터링
    let filtered = allProducts;
    if (hideDiscontinued) {
        filtered = filtered.filter(p => !p.is_discontinued);
    }
    if (searchKeyword) {
        filtered = filtered.filter(p =>
            (p.displayName && p.displayName.toLowerCase().includes(searchKeyword)) ||
            (p.goods_no && p.goods_no.toLowerCase().includes(searchKeyword)) ||
            (p.category && p.category.toLowerCase().includes(searchKeyword))
        );
    }

    if (searchStats) {
        const catLabel = selectedCategory === 'all' ? '전체 카테고리' : `'${selectedCategory}'`;
        const totalDiscCount = allProducts.filter(p => p.is_discontinued).length;
        const discNotice = (hideDiscontinued && totalDiscCount > 0) ? ` (판매종료 ${totalDiscCount}개 숨김)` : '';
        searchStats.textContent = `${catLabel} 총 ${filtered.length}개의 추적 제품이 있습니다.${discNotice}`;
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
            // 선택된 카테고리에 속한 상품 필터링 및 해당 카테고리 랭킹으로 동적 매핑
            categoryFiltered = filtered
                .filter(p => (p.catRanks && p.catRanks[selectedCategory] !== undefined) || p.category === selectedCategory)
                .map(p => {
                    if (p.catRanks && p.catRanks[selectedCategory] !== undefined) {
                        return {
                            ...p,
                            category: selectedCategory,
                            rank: p.catRanks[selectedCategory]
                        };
                    }
                    return p;
                });
        } else {
            // 'all' 전체 그리드 뷰: 복수 랭킹 중 최고 순위(최소 랭킹 숫자)를 기준으로 표시
            categoryFiltered = filtered.map(p => {
                if (p.catRanks && Object.keys(p.catRanks).length > 0) {
                    const minRank = Math.min(...Object.values(p.catRanks));
                    return {
                        ...p,
                        rank: minRank
                    };
                }
                return p;
            });
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

    // 존재하는 카테고리별 그룹화 (다중 카테고리 상품 분리 복제)
    const groups = {};
    products.forEach(p => {
        if (p.catRanks && Object.keys(p.catRanks).length > 0) {
            Object.keys(p.catRanks).forEach(cName => {
                if (!groups[cName]) groups[cName] = [];
                // 해당 카테고리에 맞는 rank와 category를 가진 파생 객체 생성
                groups[cName].push({
                    ...p,
                    category: cName,
                    rank: p.catRanks[cName]
                });
            });
        } else {
            const cat = p.category || '기타';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(p);
        }
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
        card.className = `product-card ${prod.is_discontinued ? 'is-discontinued' : ''}`;

        // 배지 생성
        let rankBadgeHtml = '';
        if (prod.is_discontinued) {
            // 판매종료 상품은 랭킹 태그를 절대 표시하지 않고 판매종료 태그만 단독 표시
            rankBadgeHtml = `<span class="badge-discontinued">⛔ [판매종료]</span>`;
        } else if (prod.is_custom) {
            rankBadgeHtml = `<span class="badge-custom">📌 직접 등록</span>`;
        } else if (prod.rank) {
            let rBadge = '';
            if (prod.rank === 1) {
                rBadge = `<span class="badge-rank badge-rank-1">👑 1위</span>`;
            } else if (prod.rank === 2) {
                rBadge = `<span class="badge-rank badge-rank-2">🥈 2위</span>`;
            } else if (prod.rank === 3) {
                rBadge = `<span class="badge-rank badge-rank-3">🥉 3위</span>`;
            } else {
                rBadge = `<span class="badge-rank badge-rank-normal">${prod.rank}위</span>`;
            }
            rankBadgeHtml = rBadge;
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
                        <span style="font-size:0.85rem; color:${prod.is_discontinued ? '#e11d48' : '#8b95a1'}; font-weight:${prod.is_discontinued ? '700' : 'normal'};">
                            ${prod.is_discontinued ? '판매 종료' : '수집 대기 중'}
                        </span>
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
        if (product.is_discontinued) {
            customBadge.textContent = `⛔ [판매종료] • ${product.category}`;
        } else {
            const rankText = product.rank ? ` • ${product.rank}위` : '';
            customBadge.textContent = product.is_custom ? '직접 등록 상품' : `${product.category} 랭킹${rankText}`;
        }
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
    currentDetailHistory = history;
    updateChartControlsUI();
    renderDetailChart(history);

    // 4. 가격 기록 테이블 렌더링
    updateTableControlsUI();
    renderHistoryTable(history);
}

/**
 * 가격 이력 데이터 기간별(일자별/월별/연별) 및 기준(최저가/평균가) 집계
 */
function aggregatePriceHistory(history, period = 'daily', metric = 'min') {
    if (!history || history.length === 0) {
        return {
            labels: [],
            data: [],
            details: [],
            period,
            metric,
            periodLabel: '일자별',
            metricLabel: '최저가'
        };
    }

    const periodMap = {
        daily: '일자별',
        monthly: '월별',
        yearly: '연별'
    };
    const metricMap = {
        min: '최저가',
        avg: '평균가'
    };

    const periodLabel = periodMap[period] || '일자별';
    const metricLabel = metricMap[metric] || '최저가';

    // 1. 기간별 그룹핑
    const groups = new Map();

    history.forEach(item => {
        if (!item.date || item.price === undefined || item.price === null) return;
        const priceNum = Number(item.price);
        if (isNaN(priceNum) || priceNum <= 0) return;

        let groupKey = '';
        if (period === 'monthly') {
            groupKey = item.date.substring(0, 7); // 'YYYY-MM'
        } else if (period === 'yearly') {
            groupKey = item.date.substring(0, 4); // 'YYYY'
        } else {
            groupKey = item.date; // 'YYYY-MM-DD'
        }

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                key: groupKey,
                prices: [],
                dates: []
            });
        }
        const g = groups.get(groupKey);
        g.prices.push(priceNum);
        g.dates.push(item.date);
    });

    // 2. 키 오름차순 정렬 (시간순)
    const sortedKeys = Array.from(groups.keys()).sort();

    const labels = [];
    const data = [];
    const details = [];

    sortedKeys.forEach(key => {
        const g = groups.get(key);
        const prices = g.prices;
        const minVal = Math.min(...prices);
        const maxVal = Math.max(...prices);
        const sum = prices.reduce((acc, cur) => acc + cur, 0);
        const avgVal = Math.round(sum / prices.length);

        const targetVal = metric === 'avg' ? avgVal : minVal;
        data.push(targetVal);

        let displayLabel = key;
        let tooltipTitle = key;
        let subInfo = null;

        if (period === 'monthly') {
            const parts = key.split('-');
            const year = parts[0];
            const month = parseInt(parts[1], 10);
            displayLabel = `${year.slice(2)}.${String(month).padStart(2, '0')}`;
            tooltipTitle = `${year}년 ${month}월`;
            subInfo = `최저: ${minVal.toLocaleString()}원 / 최고: ${maxVal.toLocaleString()}원 (${prices.length}회 기록)`;
        } else if (period === 'yearly') {
            displayLabel = `${key}년`;
            tooltipTitle = `${key}년`;
            subInfo = `최저: ${minVal.toLocaleString()}원 / 최고: ${maxVal.toLocaleString()}원 (${prices.length}회 기록)`;
        } else {
            displayLabel = key;
            tooltipTitle = key;
            if (prices.length > 1) {
                subInfo = `당일 ${prices.length}회 수집 (최저: ${minVal.toLocaleString()}원 / 최고: ${maxVal.toLocaleString()}원)`;
            }
        }

        labels.push(displayLabel);
        details.push({
            key,
            title: tooltipTitle,
            value: targetVal,
            min: minVal,
            max: maxVal,
            avg: avgVal,
            count: prices.length,
            subInfo
        });
    });

    return {
        labels,
        data,
        details,
        period,
        metric,
        periodLabel,
        metricLabel
    };
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

    const badgeEl = document.getElementById('chart-sub-badge');
    const mainTitleEl = document.getElementById('chart-main-title');

    if (!history || history.length === 0) {
        if (badgeEl) badgeEl.textContent = '데이터 없음';
        if (mainTitleEl) mainTitleEl.textContent = '📈 가격 변동 추이';
        return;
    }

    const aggregated = aggregatePriceHistory(history, currentChartPeriod, currentChartMetric);

    if (badgeEl) {
        badgeEl.textContent = `${aggregated.periodLabel} • ${aggregated.metricLabel}`;
    }
    if (mainTitleEl) {
        mainTitleEl.textContent = `📈 ${aggregated.periodLabel} 가격 변동 추이`;
    }

    if (aggregated.data.length === 0) {
        return;
    }

    const ctx = canvas.getContext('2d');
    const isAvg = currentChartMetric === 'avg';

    // 최저가는 올리브영 올리브그린(#7fa818), 평균가는 스마트 블루(#3182f6)
    const themeColor = isAvg ? '#3182f6' : '#7fa818';
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    if (isAvg) {
        gradient.addColorStop(0, 'rgba(49, 130, 246, 0.28)');
        gradient.addColorStop(1, 'rgba(49, 130, 246, 0.0)');
    } else {
        gradient.addColorStop(0, 'rgba(155, 210, 32, 0.35)');
        gradient.addColorStop(1, 'rgba(155, 210, 32, 0.0)');
    }

    // 데이터 개수에 따른 포인트 가독성 최적화
    const pointCount = aggregated.data.length;
    let pointRadius = 5;
    let pointHoverRadius = 8;
    if (pointCount <= 2) {
        pointRadius = 7;
        pointHoverRadius = 10;
    } else if (pointCount <= 10) {
        pointRadius = 6;
        pointHoverRadius = 9;
    } else if (pointCount > 40) {
        pointRadius = 3;
        pointHoverRadius = 6;
    }

    currentChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: aggregated.labels,
            datasets: [{
                label: `${aggregated.periodLabel} ${aggregated.metricLabel} (원)`,
                data: aggregated.data,
                borderColor: themeColor,
                backgroundColor: gradient,
                borderWidth: 3,
                fill: true,
                tension: 0.25,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: themeColor,
                pointBorderWidth: 2,
                pointRadius: pointRadius,
                pointHoverRadius: pointHoverRadius,
                pointHoverBackgroundColor: themeColor,
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
                    titleFont: { size: 13, family: 'Pretendard', weight: 'bold' },
                    bodyFont: { size: 13, family: 'Pretendard' },
                    padding: 12,
                    boxPadding: 4,
                    displayColors: false,
                    callbacks: {
                        title: function(tooltipItems) {
                            if (!tooltipItems || tooltipItems.length === 0) return '';
                            const idx = tooltipItems[0].dataIndex;
                            const detail = aggregated.details[idx];
                            return detail ? detail.title : tooltipItems[0].label;
                        },
                        label: function(context) {
                            return `₩ ${context.parsed.y.toLocaleString()}원 (${aggregated.metricLabel})`;
                        },
                        afterLabel: function(context) {
                            const idx = context.dataIndex;
                            const detail = aggregated.details[idx];
                            if (detail && detail.subInfo) {
                                return `📌 ${detail.subInfo}`;
                            }
                            return null;
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
                        color: '#8b95a1',
                        maxRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 12
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
 * 차트 기간/기준 버튼 활성 상태 UI 동기화
 */
function updateChartControlsUI() {
    // 1. 기간 선택 버튼 동기화
    const periodButtons = document.querySelectorAll('#chart-period-group .chart-toggle-btn');
    periodButtons.forEach(btn => {
        if (btn.dataset.period === currentChartPeriod) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 2. 기준 선택 버튼 동기화
    const metricButtons = document.querySelectorAll('#chart-metric-group .chart-toggle-btn');
    metricButtons.forEach(btn => {
        if (btn.dataset.metric === currentChartMetric) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * 차트 컨트롤(일자/월/연, 최저/평균) 클릭 이벤트 리스너 등록
 */
function setupChartControls() {
    const periodButtons = document.querySelectorAll('#chart-period-group .chart-toggle-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const period = btn.dataset.period;
            if (currentChartPeriod === period) return;
            currentChartPeriod = period;
            updateChartControlsUI();
            if (currentDetailHistory && currentDetailHistory.length > 0) {
                renderDetailChart(currentDetailHistory);
            }
        });
    });

    const metricButtons = document.querySelectorAll('#chart-metric-group .chart-toggle-btn');
    metricButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const metric = btn.dataset.metric;
            if (currentChartMetric === metric) return;
            currentChartMetric = metric;
            updateChartControlsUI();
            if (currentDetailHistory && currentDetailHistory.length > 0) {
                renderDetailChart(currentDetailHistory);
            }
        });
    });
}

/**
 * 연속 동일 가격 구간 병합
 * 날짜 오름차순의 history 데이터를 순회하여 동일 가격이 연속된 구간을 하나의 span으로 묶음
 */
function groupIdenticalPriceSpans(history) {
    if (!history || history.length === 0) return [];

    // 유효 데이터 필터링 및 날짜 오름차순 정렬
    const valid = history.filter(h => h.date && h.price !== null && !isNaN(Number(h.price)) && Number(h.price) > 0);
    if (valid.length === 0) return [];

    const sorted = [...valid].sort((a, b) => a.date.localeCompare(b.date));
    const spans = [];
    let currentSpan = null;

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const price = Number(item.price);
        const date = item.date;

        if (!currentSpan) {
            currentSpan = {
                startDate: date,
                endDate: date,
                price: price,
                count: 1,
                dates: [date]
            };
        } else if (currentSpan.price === price) {
            currentSpan.endDate = date;
            currentSpan.count++;
            currentSpan.dates.push(date);
        } else {
            spans.push(currentSpan);
            currentSpan = {
                startDate: date,
                endDate: date,
                price: price,
                count: 1,
                dates: [date]
            };
        }
    }
    if (currentSpan) {
        spans.push(currentSpan);
    }

    // 각 구간의 유지 일수 및 이전 구간 대비 변동액/변동률 계산
    spans.forEach((span, idx) => {
        const startT = new Date(span.startDate + 'T00:00:00').getTime();
        const endT = new Date(span.endDate + 'T00:00:00').getTime();
        const diffDays = Math.round((endT - startT) / (1000 * 60 * 60 * 24)) + 1;
        span.days = Math.max(diffDays, span.count);

        if (idx === 0) {
            span.diff = 0;
            span.diffPct = 0;
            span.statusType = 'initial';
            span.statusText = '최초 수집';
        } else {
            const prevSpan = spans[idx - 1];
            span.diff = span.price - prevSpan.price;
            span.diffPct = ((span.diff / prevSpan.price) * 100).toFixed(1);

            if (span.diff < 0) {
                span.statusType = 'down';
                span.statusText = '가격 인하 📉';
            } else if (span.diff > 0) {
                span.statusType = 'up';
                span.statusText = '가격 인상 📈';
            } else {
                span.statusType = 'same';
                span.statusText = '동일';
            }
        }
    });

    if (spans.length > 0) {
        spans[spans.length - 1].isCurrent = true;
    }

    return spans;
}

/**
 * 가격 변동 기록 테이블 렌더링
 * currentTableMode 에 따라 'grouped'(동일 가격 구간 묶어보기) 또는 'all'(전체 일자별) 렌더링
 */
function renderHistoryTable(history) {
    const tbody = document.getElementById('history-tbody');
    const badgeEl = document.getElementById('history-badge');
    const thDate = document.getElementById('th-date-col');
    const thDiff = document.getElementById('th-diff-col');

    if (!tbody) return;
    tbody.innerHTML = '';

    const isGrouped = currentTableMode === 'grouped';
    if (badgeEl) {
        badgeEl.textContent = isGrouped ? '구간별 묶어보기' : '전체 일자별 로그';
    }
    if (thDate) {
        thDate.textContent = isGrouped ? '기간 (유지 기간)' : '기록 날짜';
    }
    if (thDiff) {
        thDiff.textContent = isGrouped ? '이전 대비 변동' : '전일 대비 변동';
    }

    if (!history || history.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#8b95a1; padding:2rem;">아직 수집된 가격 변동 기록이 없습니다.</td></tr>`;
        return;
    }

    if (isGrouped) {
        // [구간별 묶어보기] 모드: 동일 가격 연속 구간을 묶어서 최신순으로 표시
        const spans = groupIdenticalPriceSpans(history);
        if (spans.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#8b95a1; padding:2rem;">유효한 가격 기록이 없습니다.</td></tr>`;
            return;
        }

        // 최신 구간이 맨 위에 오도록 역순 정렬
        const reversedSpans = [...spans].reverse();

        reversedSpans.forEach((span) => {
            const tr = document.createElement('tr');
            if (span.isCurrent) {
                tr.classList.add('current-price-row');
            }

            let dateHtml = '';
            if (span.startDate === span.endDate) {
                dateHtml = `<b>${span.startDate}</b> <span class="span-days-tag">1일간</span>`;
            } else {
                dateHtml = `<b>${span.startDate} ~ ${span.endDate}</b> <span class="span-days-tag">${span.days}일간</span>`;
            }
            if (span.isCurrent) {
                dateHtml += ` <span class="span-current-badge">현재 유지 중</span>`;
            }

            let diffHtml = '<span class="diff-same">-</span>';
            let statusHtml = `<span style="color:#8b95a1;">${span.statusText}</span>`;

            if (span.statusType === 'down') {
                diffHtml = `<span class="diff-down">${span.diff.toLocaleString()}원 (${span.diffPct}%)</span>`;
                statusHtml = `<span class="diff-down">${span.statusText}</span>`;
            } else if (span.statusType === 'up') {
                diffHtml = `<span class="diff-up">+${span.diff.toLocaleString()}원 (+${span.diffPct}%)</span>`;
                statusHtml = `<span class="diff-up">${span.statusText}</span>`;
            } else if (span.statusType === 'initial') {
                diffHtml = '<span class="diff-same">-</span>';
                statusHtml = `<span style="color:#3182f6;">최초 수집</span>`;
            }

            tr.innerHTML = `
                <td>${dateHtml}</td>
                <td><b>${span.price.toLocaleString()}원</b></td>
                <td>${diffHtml}</td>
                <td>${statusHtml}</td>
            `;

            tbody.appendChild(tr);
        });

    } else {
        // [전체 일자별] 모드: 매일 기록된 원본 로그를 최신순으로 표시
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
}

/**
 * 테이블 표시 모드 버튼 활성 상태 UI 동기화
 */
function updateTableControlsUI() {
    const tableButtons = document.querySelectorAll('#table-mode-group .chart-toggle-btn');
    tableButtons.forEach(btn => {
        if (btn.dataset.tableMode === currentTableMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

/**
 * 테이블 컨트롤(구간별 묶어보기/전체 일자별) 클릭 이벤트 리스너 등록
 */
function setupTableControls() {
    const tableButtons = document.querySelectorAll('#table-mode-group .chart-toggle-btn');
    tableButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const mode = btn.dataset.tableMode;
            if (currentTableMode === mode) return;
            currentTableMode = mode;
            updateTableControlsUI();
            if (currentDetailHistory && currentDetailHistory.length > 0) {
                renderHistoryTable(currentDetailHistory);
            }
        });
    });
}

/**
 * 등록 페이지 폼 처리 (register.html)
 */
/**
 * 등록 페이지 폼 처리 (register.html)
 * 새 제품 등록 시 즉시 제품 정보 및 당일 가격을 기록하여 대시보드에서 바로 트래킹
 */
function setupRegisterPage(registerForm) {
    const urlInput = document.getElementById('product-url');
    const fetchBtn = document.getElementById('btn-fetch-info');
    const previewSection = document.getElementById('product-preview-section');
    const nameInput = document.getElementById('product-name');
    const categorySelect = document.getElementById('product-category');
    const priceInput = document.getElementById('product-price');
    const unitPriceBox = document.getElementById('preview-unit-price-box');
    const unitPriceVal = document.getElementById('preview-unit-price-val');
    const submitBtn = document.getElementById('btn-submit-register');
    const messageEl = document.getElementById('message');

    function updatePreviewUnitPrice() {
        const name = nameInput ? nameInput.value.trim() : '';
        const price = priceInput ? parseInt(priceInput.value, 10) : null;
        if (name && price && price > 0) {
            const cap = parseCapacity(name);
            const unit = calculateUnitPrice(price, cap);
            if (unit && unitPriceBox && unitPriceVal) {
                unitPriceBox.style.display = 'block';
                unitPriceVal.textContent = `${unit.display} (총 ${unit.capacityLabel})`;
                return;
            }
        }
        if (unitPriceBox) unitPriceBox.style.display = 'none';
    }

    if (nameInput) nameInput.addEventListener('input', updatePreviewUnitPrice);
    if (priceInput) priceInput.addEventListener('input', updatePreviewUnitPrice);

    // URL에서 goodsNo 파싱
    function getGoodsNoFromUrl(str) {
        if (!str) return null;
        try {
            const urlObj = new URL(str);
            return urlObj.searchParams.get('goodsNo');
        } catch (e) {
            const match = str.match(/goodsNo=([A-Za-z0-9]+)/);
            return match ? match[1] : null;
        }
    }

    // 올리브영 실시간 상품 정보 조회
    async function fetchProductDetails(goodsNo) {
        if (previewSection) previewSection.style.display = 'block';
        if (messageEl) {
            messageEl.style.display = 'block';
            messageEl.innerHTML = '<span style="color:#3182f6;">⏳ 올리브영 실시간 제품명, 카테고리 및 가격 조회 중...</span>';
        }

        try {
            // 로컬 서버 API /api/scrape 시도
            const res = await fetch(`/api/scrape?goodsNo=${encodeURIComponent(goodsNo)}`, {
                signal: AbortSignal.timeout(6000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    if (data.isDiscontinued) {
                        if (data.name && nameInput) nameInput.value = data.name;
                        if (data.url && urlInput) urlInput.value = data.url;
                        if (data.category && categorySelect) categorySelect.value = data.category;
                        updatePreviewUnitPrice();
                        if (messageEl) {
                            messageEl.innerHTML = `<span style="color:#e11d48; font-weight:700;">⛔ 올리브영에서 판매종료 또는 미존재 상품으로 감지되었습니다. [판매종료] 태그가 부여된 상태로 등록됩니다.</span>`;
                        }
                        return true;
                    }
                    if (data.name || data.price) {
                        if (data.name && nameInput) nameInput.value = data.name;
                        if (data.price && priceInput) priceInput.value = data.price;
                        if (data.category && categorySelect) {
                            categorySelect.value = data.category;
                        }
                        updatePreviewUnitPrice();
                        if (messageEl) {
                            const catBadge = data.category ? ` (카테고리: ${data.category})` : '';
                            messageEl.innerHTML = `<span style="color:#16a34a; font-weight:700;">✅ 올리브영 실시간 정보${catBadge}를 성공적으로 불러왔습니다!</span>`;
                        }
                        return true;
                    }
                }
            }
        } catch (err) {
            console.log('[등록] 로컬 스크래핑 API 미응답 또는 정적 호스팅 환경:', err.message);
        }

        if (messageEl) {
            messageEl.innerHTML = '<span style="color:#64748b;">💡 제품명, 카테고리와 현재 가격을 확인 후 아래 버튼을 누르면 오늘부터 즉시 추적이 시작됩니다.</span>';
        }
        if (nameInput && !nameInput.value) {
            nameInput.placeholder = `올리브영 상품 (${goodsNo})`;
        }
        return false;
    }

    // URL 변경 시 자동 조회 트리거
    let fetchTimeout = null;
    if (urlInput) {
        urlInput.addEventListener('input', () => {
            const goodsNo = getGoodsNoFromUrl(urlInput.value.trim());
            if (goodsNo) {
                clearTimeout(fetchTimeout);
                fetchTimeout = setTimeout(() => {
                    fetchProductDetails(goodsNo);
                }, 500);
            }
        });
    }

    if (fetchBtn && urlInput) {
        fetchBtn.addEventListener('click', () => {
            const goodsNo = getGoodsNoFromUrl(urlInput.value.trim());
            if (!goodsNo) {
                alert('올바른 올리브영 상품 URL을 먼저 입력해주세요 (goodsNo 포함).');
                urlInput.focus();
                return;
            }
            fetchProductDetails(goodsNo);
        });
    }

    // 등록 폼 제출 시
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let urlValue = urlInput ? urlInput.value.trim() : '';
        const goodsNo = getGoodsNoFromUrl(urlValue);

        if (!goodsNo) {
            if (messageEl) {
                messageEl.style.display = 'block';
                messageEl.innerHTML = '<span style="color:#f04452;">올바른 올리브영 상품 링크가 아닙니다 (goodsNo 파라미터를 찾을 수 없습니다).</span>';
            }
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '🚀 데이터베이스 등록 및 즉시 트래킹 처리 중...';
        }
        if (messageEl) {
            messageEl.style.display = 'block';
            messageEl.innerHTML = '<span style="color:#3182f6;">데이터베이스에 상품 및 당일 가격 기록을 등록하는 중입니다...</span>';
        }

        let rawNameVal = nameInput && nameInput.value.trim() ? nameInput.value.trim() : '';
        let name = (rawNameVal && rawNameVal !== goodsNo) ? rawNameVal : `올리브영 상품 (${goodsNo})`;
        let price = priceInput && priceInput.value ? parseInt(priceInput.value, 10) : null;
        let selectedCat = categorySelect ? categorySelect.value : '기타';

        try {
            // 만약 아직 가격/이름 조회가 안 된 상태에서 등록을 눌렀다면 한 번 더 API 조회 시도
            if (!price) {
                try {
                    const apiRes = await fetch(`/api/scrape?goodsNo=${encodeURIComponent(goodsNo)}`, { signal: AbortSignal.timeout(4000) });
                    if (apiRes.ok) {
                        const apiData = await apiRes.json();
                        if (apiData.name) name = apiData.name;
                        if (apiData.price) price = apiData.price;
                        if (apiData.category && categorySelect) {
                            categorySelect.value = apiData.category;
                            selectedCat = apiData.category;
                        }
                    }
                } catch (e) {}
            }

            // URL에 카테고리 정보가 없으면 선택된 카테고리 파라미터 결합
            if (selectedCat && !urlValue.includes('catName=') && !urlValue.includes('category=')) {
                const matchedCat = CATEGORY_LIST.find(c => c.name === selectedCat);
                const catParam = `&catName=${encodeURIComponent(selectedCat)}${matchedCat ? `&dispCatNo=${matchedCat.id}` : ''}`;
                urlValue += (urlValue.includes('?') ? catParam : `?goodsNo=${goodsNo}${catParam}`);
            }

            // 1. products 테이블에 상품 등록 / 업데이트 (upsert)
            const { error: prodError } = await supabaseClient
                .from('products')
                .upsert([
                    { goods_no: goodsNo, name, url: urlValue, is_custom: true }
                ], { onConflict: 'goods_no' });

            if (prodError) throw prodError;

            // 2. prices 테이블에 오늘 일자 가격 즉시 저장 (당일 트래킹 즉시 시작)
            const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
            let priceRecorded = false;

            if (price && price > 0) {
                const { error: priceError } = await supabaseClient
                    .from('prices')
                    .upsert([
                        { goods_no: goodsNo, price, date: today }
                    ], { onConflict: 'goods_no,date' });

                if (!priceError) {
                    priceRecorded = true;
                } else {
                    console.warn('[등록] 가격 기록 upsert 오류:', priceError);
                }
            }

            // 단위가격 계산
            const cap = parseCapacity(name);
            const unit = calculateUnitPrice(price, cap);
            const unitPriceText = unit ? ` • ${unit.display}` : '';
            const priceText = price ? `${price.toLocaleString()}원${unitPriceText}` : '수집 대기 중';

            // 성공 UI 출력
            if (messageEl) {
                messageEl.innerHTML = `
                    <div class="success-box">
                        <div class="success-title">🎉 등록 완료 & 즉시 트래킹 시작!</div>
                        <div class="success-name">${escapeHtml(name)}</div>
                        <div class="success-price">기준 가격: <b>${priceText}</b> (기준일: ${today})</div>
                        <div style="margin-top: 1.2rem;">
                            <a href="index.html#goodsNo=${goodsNo}" class="btn-go-dashboard">
                                📊 대시보드에서 가격 추이 확인하기 →
                            </a>
                        </div>
                    </div>
                `;
            }

            // 입력 필드 초기화
            if (urlInput) urlInput.value = '';
            if (nameInput) nameInput.value = '';
            if (priceInput) priceInput.value = '';
            if (previewSection) previewSection.style.display = 'none';

        } catch (error) {
            console.error('[등록 오류]', error);
            if (messageEl) {
                messageEl.innerHTML = `<span style="color:#f04452;">등록 중 오류가 발생했습니다: ${escapeHtml(error.message)}</span>`;
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '⚡ 등록하고 즉시 트래킹 시작';
            }
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

