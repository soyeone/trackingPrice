// Supabase 설정
const SUPABASE_URL = 'https://lgdrqxsgmfighunegehv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594';

// Supabase 클라이언트 초기화 (글로벌 var supabase 와 충돌 방지를 위해 supabaseClient 명명)
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    // 등록 폼 처리
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!supabaseClient) {
                alert('Supabase 설정이 필요합니다.');
                return;
            }

            const urlInput = document.getElementById('product-url').value;
            const messageEl = document.getElementById('message');

            try {
                // URL에서 goodsNo 파싱
                const url = new URL(urlInput);
                const goodsNo = url.searchParams.get('goodsNo');
                
                if (!goodsNo) {
                    messageEl.textContent = '올바른 올리브영 상품 URL이 아닙니다 (goodsNo 없음).';
                    messageEl.style.color = 'red';
                    return;
                }

                messageEl.textContent = '등록 중...';
                
                // Supabase에 데이터 삽입
                const { data, error } = await supabaseClient
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
    if (chartsContainer && supabaseClient) {
        try {
            // 제품 목록 가져오기
            const { data: products, error: pError } = await supabaseClient
                .from('products')
                .select('*');
            
            if (pError) throw pError;

            // 가격 데이터 가져오기
            const { data: prices, error: prError } = await supabaseClient
                .from('prices')
                .select('*')
                .order('date', { ascending: true });

            if (prError) throw prError;

            chartsContainer.innerHTML = ''; // Loading 텍스트 제거

            if (!products || products.length === 0) {
                chartsContainer.innerHTML = '<p>추적 중인 제품이 없습니다. [제품 등록] 메뉴에서 상품을 추가해보세요!</p>';
                return;
            }

            let renderedCount = 0;

            products.forEach(product => {
                // 해당 제품의 가격 데이터 필터링
                const productPrices = prices.filter(p => p.goods_no === product.goods_no);
                if (productPrices.length === 0) return;

                renderedCount++;
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

            if (renderedCount === 0) {
                chartsContainer.innerHTML = `<p>현재 <b>${products.length}</b>개의 제품이 추적 등록되어 있으나, 아직 수집된 가격 데이터가 없습니다.<br>스크래퍼가 매일 아침(또는 GitHub Actions 수동 실행 시) 가격을 수집하면 이곳에 그래프가 표시됩니다.</p>`;
            }

        } catch (error) {
            console.error(error);
            chartsContainer.innerHTML = `<p style="color:red">데이터를 불러오는 중 오류가 발생했습니다: ${error.message}</p>`;
        }
    }
});
