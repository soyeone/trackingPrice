import os
import sys
import time
import re
from datetime import date
import traceback
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

# 환경 변수가 없거나 유효하지 않을 때 사용할 기본 Supabase 프로젝트 정보
DEFAULT_SUPABASE_URL = "https://lgdrqxsgmfighunegehv.supabase.co"
DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxnZHJxeHNnbWZpZ2h1bmVnZWh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTgwNDUsImV4cCI6MjEwNDI3NDA0NX0.CvJYLnbgt3C0PTBXBZoqopfoRRfT8KCTFYCnk8Pg594"

def clean_credentials():
    raw_url = os.getenv("SUPABASE_URL") or DEFAULT_SUPABASE_URL
    raw_key = os.getenv("SUPABASE_KEY") or DEFAULT_SUPABASE_KEY

    # 앞뒤 공백 및 따옴표 제거
    url = raw_url.strip().strip('"').strip("'")
    if "/rest/v1" in url:
        url = url.split("/rest/v1")[0]
    url = url.rstrip("/")

    key = raw_key.strip().strip('"').strip("'")
    return url, key

try:
    from supabase import create_client, Client
except ImportError:
    print("[ERROR] supabase 패키지를 import할 수 없습니다.")
    traceback.print_exc()
    sys.exit(1)

target_url, target_key = clean_credentials()
print(f"Supabase 연결 시도 대상 URL: {target_url}")

try:
    supabase: Client = create_client(target_url, target_key)
    # 간단한 연결 테스트
    _ = supabase.table('products').select('id').limit(1).execute()
    print("Supabase 클라이언트 초기화 및 연결 성공!")
except Exception as e:
    print(f"[경고] 제공된 Secret으로 Supabase 연결 실패: {e}")
    print("기본 URL 및 API Key로 폴백(Fallback) 연결을 시도합니다...")
    try:
        supabase: Client = create_client(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY)
        _ = supabase.table('products').select('id').limit(1).execute()
        print("기본 Supabase 정보로 연결 성공!")
    except Exception as e2:
        print(f"[FATAL] Supabase 연결 완전 실패: {e2}")
        traceback.print_exc()
        sys.exit(1)

# 브라우저와 동일한 헤더 설정
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

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
    soup = BeautifulSoup(html_text, 'html.parser')
    items = []
    
    for prd in soup.select('.prd_info'):
        try:
            name_el = prd.select_one('.prd_name .tx_name') or prd.select_one('.tx_name')
            if not name_el:
                continue
            name = name_el.text.strip()
            
            price_el = prd.select_one('.prd_price .tx_cur .tx_num') or prd.select_one('.tx_cur .tx_num')
            if not price_el:
                continue
            price_raw = price_el.text.replace(',', '').replace('원', '').strip()
            if not price_raw.isdigit():
                continue
            price = int(price_raw)
            
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
        except Exception:
            continue
            
    return items

def fetch_category_ranking(cat_name, cat_id):
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
        print(f"[{cat_name}] 수집 중 오류 (건너뜀): {e}")
        return []

def fetch_single_product_detail(goods_no, existing_url=None):
    """
    올리브영 모바일 상세 페이지에서 상품명과 가격을 정확하게 파싱합니다.
    모바일 페이지는 NetFUNNEL 차단이 없고 내부 상태 JSON(goodsName, finalPrice)이 포함되어 있습니다.
    """
    mobile_url = f"https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo={goods_no}"
    mobile_headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    
    try:
        res = requests.get(mobile_url, headers=mobile_headers, timeout=15)
        res.raise_for_status()
        html_text = res.text
        
        name = None
        price = None
        
        # 1. goodsName 정규식 검색
        name_match = re.search(r'"goodsName"\s*:\s*"([^"]+)"', html_text)
        if name_match:
            try:
                import json
                name = json.loads(f'"{name_match.group(1)}"')
            except Exception:
                name = name_match.group(1)
                
        # 2. finalPrice 정규식 검색 (할인가 우선, 없으면 정상가)
        price_match = re.search(r'"finalPrice"\s*:\s*([0-9]+)', html_text)
        if price_match:
            price = int(price_match.group(1))
        else:
            price_match = re.search(r'"salePrice"\s*:\s*([0-9]+)', html_text)
            if price_match:
                price = int(price_match.group(1))
                
        # 3. 폴백: OpenGraph 태그 및 BeautifulSoup 파싱
        if not name or not price:
            soup = BeautifulSoup(html_text, 'html.parser')
            if not name:
                og_title = soup.select_one('meta[property="og:title"]')
                if og_title and og_title.get('content'):
                    name = og_title.get('content').replace(' | 올리브영', '').strip()
            if not price:
                price_el = soup.select_one('.price .sell_price') or soup.select_one('.price_num') or soup.select_one('.tx_num')
                if price_el:
                    num_str = re.sub(r'[^0-9]', '', price_el.text)
                    if num_str:
                        price = int(num_str)
                        
        if goods_no and price:
            target_url = existing_url or f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}"
            print(f"  단일 상품 [{goods_no}] 파싱 성공: {name} (현재가: {price:,}원)")
            return {
                'goods_no': goods_no,
                'name': name or f"올리브영 상품 ({goods_no})",
                'price': price,
                'url': target_url
            }
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
        time.sleep(1)
        
    # 2. 사용자가 직접 등록한 제품 수집
    try:
        print("사용자 직접 등록 상품 목록 조회 중...")
        res = supabase.table('products').select('*').eq('is_custom', True).execute()
        custom_list = res.data or []
        print(f"사용자 등록 상품 수: {len(custom_list)}")
        
        for cp in custom_list:
            g_no = cp['goods_no']
            if g_no not in all_products:
                print(f"사용자 등록 상품 [{g_no}] 개별 가격 수집 중...")
                item = fetch_single_product_detail(g_no, cp.get('url'))
                if item:
                    item['is_custom'] = True
                    all_products[g_no] = item
                time.sleep(1)
            else:
                all_products[g_no]['is_custom'] = True
    except Exception as e:
        print(f"사용자 등록 상품 처리 오류: {e}")

    print(f"\n총 {len(all_products)}개 유니크 상품의 가격 데이터를 DB에 저장합니다.")
    
    # 3. Supabase DB에 저장
    success_count = 0
    for goods_no, item in all_products.items():
        try:
            # 제품 존재 여부 확인 후 삽입 또는 갱신
            check_res = supabase.table('products').select('id').eq('goods_no', item['goods_no']).execute()
            if check_res.data and len(check_res.data) > 0:
                supabase.table('products').update({
                    'name': item['name'],
                    'url': item['url']
                }).eq('goods_no', item['goods_no']).execute()
            else:
                supabase.table('products').insert({
                    'goods_no': item['goods_no'],
                    'name': item['name'],
                    'url': item['url'],
                    'is_custom': item.get('is_custom', False)
                }).execute()
            
            # 가격 테이블에 오늘 가격 삽입
            supabase.table('prices').insert({
                'goods_no': item['goods_no'],
                'price': item['price'],
                'date': today
            }).execute()
            
            success_count += 1
        except Exception:
            continue
            
    print(f"=== 완료! {success_count}개 상품 가격 데이터 저장 완료 ===")

if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        print(f"\n[FATAL ERROR] 실행 중 예외 발생:")
        traceback.print_exc()
        sys.exit(1)
