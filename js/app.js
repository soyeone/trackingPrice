// Supabase 설정 (사용자가 직접 채워넣어야 함)
const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

// Supabase 클라이언트 초기화
// 사용자가 설정을 안했으면 동작 안함
let supabase;
if (SUPABASE_URL !== 'https://lgdrqxsgmfighunegehv.supabase.co/rest/v1/') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

document.addEventListener('DOMContentLoaded', async () => {
    // 등록 폼 처리
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!supabase) {
                alert('Supabase 설정이 필요합니다. app.js에 URL과 KEY를 입력해주세요.');
                return;
            }

            const urlInput = document.getElementById('product-url').value;
            const messageEl = document.getElementById('message');

            try {
                // URL에서 goodsNo 파싱 (간단한 예시)
                const url = new URL(urlInput);
                const goodsNo = url.searchParams.get('goodsNo');
                
                if (!goodsNo) {
                    messageEl.textContent = '올바른 올리브영 상품 URL이 아닙니다 (goodsNo 없음).';
                    messageEl.style.color = 'red';
                    return;
                }

                messageEl.textContent = '등록 중...';
                
                // Supabase에 데이터 삽입
                const { data, error } = await supabase
                    .from('products')
                    .insert([
                        { goods_no: goodsNo, url: urlInput, is_custom: true }
                    ]);

                if (error) throw error;
                
                messageEl.textContent = '성공적으로 등록되었습니다! 내일부터 자동으로 가격이 추적됩니다.';
                messageEl.style.color = 'green';
                document.getElementById('product-url').value = '';

            } catch (error) {
                console.error(error);
                messageEl.textContent = '등록 중 오류가 발생했습니다: ' + error.message;
                messageEl.style.color = 'red';
            }
        });
    }

    // 대시보드 차트 렌더링
    const chartsContainer = document.getElementById('charts-container');
    if (chartsContainer && supabase) {
        chartsContainer.innerHTML = ''; // Loading 텍스트 제거

        try {
            // 제품 목록 가져오기
            const { data: products, error: pError } = await supabase
                .from('products')
                .select('*');
            
            if (pError) throw pError;

            // 가격 데이터 가져오기
            const { data: prices, error: prError } = await supabase
                .from('prices')
                .select('*')
                .order('date', { ascending: true });

            if (prError) throw prError;

            if (products.length === 0) {
                chartsContainer.innerHTML = '<p>추적 중인 제품이 없습니다.</p>';
                return;
            }

            products.forEach(product => {
                // 해당 제품의 가격 데이터 필터링
                const productPrices = prices.filter(p => p.goods_no === product.goods_no);
                if (productPrices.length === 0) return;

                const wrapper = document.createElement('div');
                wrapper.className = 'chart-wrapper';
                
                const title = document.createElement('h3');
                const link = document.createElement('a');
                link.href = product.url;
                link.textContent = product.name || `제품 (${product.goods_no})`;
                link.target = '_blank';
                title.appendChild(link);
                wrapper.appendChild(title);

                const canvas = document.createElement('canvas');
                wrapper.appendChild(canvas);
                chartsContainer.appendChild(wrapper);

                const labels = productPrices.map(p => p.date);
                const data = productPrices.map(p => p.price);

                new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: '가격 (원)',
                            data: data,
                            borderColor: '#9bd220',
                            tension: 0.1
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            y: {
                                beginAtZero: false
                            }
                        }
                    }
                });
            });

        } catch (error) {
            console.error(error);
            chartsContainer.innerHTML = `<p style="color:red">데이터를 불러오는 중 오류가 발생했습니다: ${error.message}</p>`;
        }
    } else if (chartsContainer && !supabase) {
        chartsContainer.innerHTML = '<p style="color:red">Supabase 설정이 필요합니다. app.js에 URL과 KEY를 입력해주세요.</p>';
    }
});
