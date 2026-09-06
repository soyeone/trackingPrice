import os
import requests
from bs4 import BeautifulSoup
from supabase import create_client, Client
from datetime import date
import time
import re
from dotenv import load_dotenv

load_dotenv()

# 환경 변수가 없으면 기본 Supabase 프로젝트 정보 사용
DEFAULT_SUPABASE_URL = "https://lgdrqxsgmfighunegehv.supabase.co"
DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594"

SUPABASE_URL = os.getenv("SUPABASE_URL") or DEFAULT_SUPABASE_URL
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or DEFAULT_SUPABASE_KEY

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# 브라우저와 동일한 헤더 설정
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

# 올리브영 주요 대분류 카테고리 ID 목록
# 10000010001: 스킨케어, 10000010009: 마스크팩, 10000010010: 클렌징, 10000010011: 선케어
# 10000010002: 메이크업/네일, 10000010003: 바디케어, 10000010004: 헤어케어, 10000010005: 향수/디퓨저
# 10000010008: 미용소품, 10000020001: 건강식품, 10000020002: 푸드, 10000030005: 구강/위생
MAIN_CATEGORIES = [
    ('전체', ''),
    ('스킨케어', '10000010001'),
    ('마스크팩', '10000010009'),
    ('클렌징', '10000010010'),
    ('선케어', '10000010011'),
    ('메이크업/네일', '10000010002'),
    ('바디케어', '10000010003'),
    ('헤어케어', '10000010004'),
    ('향수/디퓨저', '10000010005'),
    ('건강식품', '10000020001'),
]

session = requests.Session()
session.headers.update(HEADERS)

def parse_items_from_html(html_text):
    """HTML 텍스트에서 .prd_info 요소들을 파싱하여 상품 정보 목록을 반환합니다."""
    soup = BeautifulSoup(html_text, 'html.parser')
    items = []
    
    for prd in soup.select('.prd_info'):
        try:
            # 상품명 추출
            name_el = prd.select_one('.prd_name .tx_name') or prd.select_one('.tx_name')
            if not name_el:
                continue
            name = name_el.text.strip()
            
            # 가격 추출 (.tx_cur .tx_num)
            price_el = prd.select_one('.prd_price .tx_cur .tx_num') or prd.select_one('.tx_cur .tx_num')
            if not price_el:
                continue
            price_raw = price_el.text.replace(',', '').replace('원', '').strip()
            if not price_raw.isdigit():
                continue
            price = int(price_raw)
            
            # goodsNo 추출
            goods_no = None
            thumb_a = prd.select_one('a.prd_thumb') or prd.select_one('a')
            if thumb_a:
                goods_no = thumb_a.get('data-ref-goodsno')
                if not goods_no and 'goodsNo=' in thumb_a.get('href', ''):
                    match = re.search(r'goodsNo=([A-Za-z0-9]+)', thumb_a.get('href', ''))
                    if match:
                        goods_no = match.group(1)
            
            if not goods_no:
                cart_btn = prd.select_one('.cartBtn')
                if cart_btn:
                    goods_no = cart_btn.get('data-ref-goodsno')
                    
            if goods_no:
                items.append({
                    'goods_no': goods_no,
                    'name': name,
                    'price': price,
                    'url': f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
                })
        except Exception as e:
            continue
            
    return items

def fetch_category_ranking(cat_name, cat_id):
    """특정 카테고리의 랭킹 페이지를 조회합니다."""
    if cat_id:
        url = f"https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo={cat_id}&fltDispCatNo=&pageIdx=1&rowsPerPage=100"
    else:
        url = "https://www.oliveyoung.co.kr/store/main/getBestList.do"
        
    try:
        res = session.get(url, timeout=15)
        res.raise_for_status()
        items = parse_items_from_html(res.text)
        print(f"[{cat_name}] {len(items)}개 상품 수집 완료")
        return items
    except Exception as e:
        print(f"[{cat_name}] 수집 중 오류: {e}")
        return []

def fetch_single_product_detail(goods_no, existing_url=None):
    """사용자가 직접 등록한 단일 상품의 최신 가격을 조회합니다."""
    url = existing_url or f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
    try:
        res = session.get(url, timeout=15)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, 'html.parser')
        
        name_el = soup.select_one('.prd_info .prd_name') or soup.select_one('.prd_name') or soup.select_one('title')
        name = name_el.text.strip() if name_el else f"상품 {goods_no}"
        
        price_el = soup.select_one('.price .sell_price') or soup.select_one('.price_num') or soup.select_one('.price-2')
        if price_el:
            price_str = price_el.text.replace(',', '').replace('원', '').strip()
            if price_str.isdigit():
                return {'goods_no': goods_no, 'name': name, 'price': int(price_str), 'url': url}
    except Exception as e:
        print(f"단일 상품 [{goods_no}] 상세 페이지 수집 오류: {e}")
    return None

def main():
    today = date.today().isoformat()
    print(f"=== 올리브영 가격 스크래핑 시작 ({today}) ===")
    
    all_products = {}
    
    # 1. 주요 카테고리별 랭킹 100위 수집
    for cat_name, cat_id in MAIN_CATEGORIES:
        items = fetch_category_ranking(cat_name, cat_id)
        for item in items:
            all_products[item['goods_no']] = item
        time.sleep(1) # 요청 간 1초 딜레이
        
    # 2. 사용자가 직접 등록한 제품 (is_custom=True) 수집
    try:
        print("사용자 직접 등록 상품 조회 중...")
        res = supabase.table('products').select('*').eq('is_custom', True).execute()
        custom_list = res.data or []
        print(f"사용자 등록 상품 수: {len(custom_list)}")
        
        for cp in custom_list:
            g_no = cp['goods_no']
            if g_no not in all_products:
                print(f"사용자 등록 상품 [{g_no}] 개별 수집 시도...")
                item = fetch_single_product_detail(g_no, cp.get('url'))
                if item:
                    item['is_custom'] = True
                    all_products[g_no] = item
                time.sleep(1)
            else:
                # 이미 랭킹에 있는 경우 is_custom 유지
                all_products[g_no]['is_custom'] = True
    except Exception as e:
        print(f"사용자 등록 상품 처리 오류: {e}")

    print(f"\n총 {len(all_products)}개 유니크 상품의 가격 데이터를 DB에 저장합니다.")
    
    # 3. Supabase DB에 저장
    success_count = 0
    for goods_no, item in all_products.items():
        try:
            # products 테이블 업데이트
            supabase.table('products').upsert({
                'goods_no': item['goods_no'],
                'name': item['name'],
                'url': item['url'],
                'is_custom': item.get('is_custom', False)
            }, on_conflict='goods_no').execute()
            
            # prices 테이블에 오늘의 가격 추가
            supabase.table('prices').insert({
                'goods_no': item['goods_no'],
                'price': item['price'],
                'date': today
            }).execute()
            
            success_count += 1
        except Exception as e:
            # 중복 날짜 가격 등은 조용히 패스
            continue
            
    print(f"=== 완료! {success_count}개 상품 가격 저장 완료 ===")

if __name__ == "__main__":
    main()
