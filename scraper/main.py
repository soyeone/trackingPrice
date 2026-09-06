import os
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client
from datetime import date
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Supabase credentials not found in environment variables.")
    exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 올리브영 헤더 (Bot 차단 우회용)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
}

def get_price(goods_no):
    """
    상품 번호로 올리브영 상품 상세 페이지에서 가격을 스크래핑합니다.
    (실제 HTML 구조에 맞게 수정이 필요할 수 있습니다)
    """
    url = f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 상품명 추출
        name_element = soup.select_one('.right_area .prd_info .prd_name')
        name = name_element.text.strip() if name_element else f"Product {goods_no}"
        
        # 가격 추출 (세일가 또는 일반가)
        price_element = soup.select_one('.price .sell_price')
        if not price_element:
            price_element = soup.select_one('.price .price_num') # 백업 클래스
            
        if price_element:
            # "15,000" -> 15000 변환
            price_str = price_element.text.replace(',', '').replace('원', '').strip()
            return name, int(price_str)
        else:
            print(f"[{goods_no}] 가격 정보를 찾을 수 없습니다.")
            return name, None
            
    except Exception as e:
        print(f"[{goods_no}] 스크래핑 오류: {e}")
        return None, None

def main():
    # 1. DB에서 추적 대상 상품 목록 가져오기
    print("DB에서 상품 목록 조회 중...")
    response = supabase.table('products').select('*').execute()
    products = response.data
    
    if not products:
        print("추적할 상품이 없습니다.")
        return
        
    today = date.today().isoformat()
    
    for product in products:
        goods_no = product['goods_no']
        print(f"스크래핑 진행 중: {goods_no}")
        
        name, price = get_price(goods_no)
        
        if price is not None:
            # 2. 이름이 업데이트 안된 경우 업데이트
            if not product.get('name') or product.get('name').startswith('Product'):
                supabase.table('products').update({'name': name}).eq('goods_no', goods_no).execute()
                
            # 3. 가격 데이터 저장
            try:
                supabase.table('prices').insert({
                    'goods_no': goods_no,
                    'price': price,
                    'date': today
                }).execute()
                print(f"[{goods_no}] 가격 업데이트 완료: {price}원")
            except Exception as e:
                print(f"[{goods_no}] DB 삽입 오류: {e}")

if __name__ == "__main__":
    main()
