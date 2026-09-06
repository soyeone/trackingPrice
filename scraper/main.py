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
    ('스킨케어', '10000010001'),
    ('마스크팩', '10000010009'),
    ('클렌징', '10000010010'),
    ('선케어', '10000010011'),
    ('메이크업', '10000010002'),
    ('더모 코스메틱', '10000010008'),
    ('헤어케어', '10000010004'),
    ('바디케어', '10000010003'),
    ('향수/디퓨저', '10000010005'),
    ('건강식품', '10000020001'),
    ('구강용품', '10000020003'),
    ('맨즈에딧', '10000010007'),
]

session = requests.Session()
session.headers.update(HEADERS)

def parse_items_from_html(html_text, cat_name='', cat_id=''):
    import urllib.parse
    soup = BeautifulSoup(html_text, 'html.parser')
    items = []
    
    for idx, prd in enumerate(soup.select('.prd_info'), start=1):
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
                rank = idx
                rank_el = prd.select_one('.thumb_flag')
                if rank_el and rank_el.text.strip().isdigit():
                    rank = int(rank_el.text.strip())
                
                cat_param = f"&dispCatNo={cat_id}&catName={urllib.parse.quote(cat_name)}&rank={rank}" if cat_name else ""
                items.append({
                    'goods_no': goods_no,
                    'name': name,
                    'price': price,
                    'rank': rank,
                    'category': cat_name,
                    'url': f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={goods_no}{cat_param}"
                })
        except Exception:
            continue
            
    return items

def fetch_category_ranking(cat_name, cat_id):
    if cat_id:
        url = f"https://www.oliveyoung.co.kr/store/main/getBestList.do?dispCatNo=900000100100001&fltDispCatNo={cat_id}&pageIdx=1&rowsPerPage=100"
    else:
        url = "https://www.oliveyoung.co.kr/store/main/getBestList.do"
        
    try:
        res = session.get(url, timeout=15)
        res.raise_for_status()
        items = parse_items_from_html(res.text, cat_name, cat_id)
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
        
    # 2. DB에 등록된 모든 기존 상품 확인 (100위 밖으로 밀려난 상품 + 직접 등록 상품도 누락 없이 가격 추적)
    try:
        print("DB에 등록된 기존 추적 상품 목록 조회 중...")
        all_db_products = []
        from_idx = 0
        batch_size = 1000
        while True:
            res = supabase.table('products').select('goods_no, name, url, is_custom').range(from_idx, from_idx + batch_size - 1).execute()
            batch = res.data or []
            if not batch:
                break
            all_db_products.extend(batch)
            if len(batch) < batch_size:
                break
            from_idx += batch_size

        print(f"DB 등록 기존 상품 총 {len(all_db_products)}개")

        # 오늘의 12개 카테고리 TOP 100에 포함되지 않은 상품 식별
        out_of_ranking_products = [p for p in all_db_products if p['goods_no'] not in all_products]
        print(f"오늘 TOP 100 순위 밖이지만 지속 추적할 기존 상품 수: {len(out_of_ranking_products)}개")

        for p in out_of_ranking_products:
            g_no = p['goods_no']
            orig_url = p.get('url') or ''
            # 100위권 밖으로 밀려난 경우 URL의 &rank=... 파라미터만 제거하고 카테고리 정보는 유지
            updated_url = re.sub(r'&rank=[0-9]+', '', orig_url)

            item = fetch_single_product_detail(g_no, updated_url)
            if item:
                item['name'] = p.get('name') or item.get('name')
                item['is_custom'] = p.get('is_custom', False)
                item['url'] = updated_url
                all_products[g_no] = item
            else:
                # 상세 페이지 파싱 실패 시에도 기존 URL 정보 보존
                pass
            time.sleep(0.3)
    except Exception as e:
        print(f"기존 등록 상품 지속 추적 처리 오류: {e}")

    print(f"\n총 {len(all_products)}개 상품(신규 진입 + 기존 100위 유지 + 100위 이탈 추적)의 가격 데이터를 DB에 저장합니다.")

    # 3. Supabase DB에 저장 (신규 상품은 자동 insert, 기존 상품은 update, 일일 가격 insert)
    success_count = 0
    for goods_no, item in all_products.items():
        try:
            # 3-1. 제품 존재 여부 확인 후 신규 삽입 또는 정보 갱신
            check_res = supabase.table('products').select('id').eq('goods_no', item['goods_no']).execute()
            if check_res.data and len(check_res.data) > 0:
                # 기존 등록 제품: 최신 제품명과 랭킹/URL 갱신
                supabase.table('products').update({
                    'name': item['name'],
                    'url': item['url']
                }).eq('goods_no', item['goods_no']).execute()
            else:
                # 100위권에 새로 진입한 신규 제품: 자동 등록!
                supabase.table('products').insert({
                    'goods_no': item['goods_no'],
                    'name': item['name'],
                    'url': item['url'],
                    'is_custom': item.get('is_custom', False)
                }).execute()

            # 3-2. 일별 가격 테이블에 오늘 가격 기록
            # 동일 날짜 중복 실행 시에도 안전하도록 처리
            supabase.table('prices').upsert({
                'goods_no': item['goods_no'],
                'price': item['price'],
                'date': today
            }, on_conflict='goods_no,date').execute()

            success_count += 1
        except Exception as err:
            # upsert 지원 제약 시 fallback 일반 insert 시도
            try:
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
