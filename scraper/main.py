import os
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client
from datetime import date
import time
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Supabase credentials not found in environment variables.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
}

def get_categories():
    """올리브영 베스트 페이지에서 카테고리 목록(ID)을 추출합니다."""
    url = "https://www.oliveyoung.co.kr/store/main/getBestList.do"
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        categories = []
        # 카테고리 탭 (실제 사이트의 탭 리스트 선택자 확인 필요)
        # 통상적으로 getBestList.do의 탭들에 dispCatNo가 있음
        for a in soup.select('.best-cate-list button, .best-cate-list a, .cate_menu a'):
            # href나 data-ref-dispcateno 등에서 추출
            cat_no = a.get('data-ref-dispcateno')
            if not cat_no and 'dispCatNo=' in a.get('href', ''):
                cat_no = a.get('href').split('dispCatNo=')[1].split('&')[0]
            if cat_no and cat_no not in categories and cat_no != '900000100100000': # '전체' 제외
                categories.append(cat_no)
        
        # 카테고리 파싱 실패시 기본 카테고리(스킨케어, 메이크업, 바디, 헤어) ID 하드코딩 백업
        if not categories:
            categories = ['10000010001', '10000010002', '10000010003', '10000010004']
        return categories
    except Exception as e:
        print(f"카테고리 수집 오류: {e}")
        return []

def fetch_top_100(dispCatNo):
    """특정 카테고리의 탑 100 제품 정보를 스크래핑합니다."""
    url = f"https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo={dispCatNo}&fltDispCatNo=&pageIdx=1&rowsPerPage=100"
    products = []
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        
        # 상품 리스트 찾기
        items = soup.select('.prd_info')
        for item in items:
            name_el = item.select_one('.tx_name')
            price_el = item.select_one('.tx_cur .tx_num')
            link_el = item.find_parent('a')
            
            if name_el and price_el and link_el:
                name = name_el.text.strip()
                price_str = price_el.text.replace(',', '').replace('원', '').strip()
                href = link_el.get('href', '')
                
                # goodsNo 추출
                goods_no = None
                if 'goodsNo=' in href:
                    goods_no = href.split('goodsNo=')[1].split('&')[0]
                elif 'javascript:goodsDetail' in href:
                    goods_no = href.split("'")[1]
                
                if goods_no and price_str.isdigit():
                    products.append({
                        'goods_no': goods_no,
                        'name': name,
                        'price': int(price_str),
                        'url': f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
                    })
        return products
    except Exception as e:
        print(f"[{dispCatNo}] 카테고리 탑 100 수집 오류: {e}")
        return []

def main():
    today = date.today().isoformat()
    
    # 1. 탑 100 크롤링
    print("대분류 카테고리 탑 100 스크래핑 시작...")
    categories = get_categories()
    print(f"추출된 카테고리 수: {len(categories)}")
    
    scraped_data = {} # 중복 제거용 딕셔너리
    
    for cat_no in categories:
        print(f"카테고리 {cat_no} 탑 100 수집 중...")
        items = fetch_top_100(cat_no)
        for item in items:
            scraped_data[item['goods_no']] = item
        time.sleep(1) # 차단 방지 딜레이
        
    # 2. DB에서 사용자 직접 등록 제품 가져오기
    print("DB에서 사용자 등록 상품 목록 조회 중...")
    response = supabase.table('products').select('*').eq('is_custom', True).execute()
    custom_products = response.data
    
    # 사용자 등록 제품 중 탑 100에 없으면 개별 스크래핑
    # (실제 환경에서는 get_price 함수를 별도로 분리해서 사용하거나, 기존 코드를 유지)
    
    print(f"총 {len(scraped_data)}개의 유니크 상품 가격을 업데이트합니다.")
    
    for goods_no, info in scraped_data.items():
        # products 테이블 갱신 (upsert)
        try:
            supabase.table('products').upsert({
                'goods_no': info['goods_no'],
                'url': info['url'],
                'name': info['name'],
                'is_custom': False
            }, on_conflict='goods_no').execute()
            
            # prices 테이블 추가
            supabase.table('prices').insert({
                'goods_no': info['goods_no'],
                'price': info['price'],
                'date': today
            }).execute()
        except Exception as e:
            pass # 중복 키 에러(오늘 이미 추가됨) 등은 무시
            
    print("완료!")

if __name__ == "__main__":
    main()
