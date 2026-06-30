-- Supabase 대시보드 > SQL Editor 에서 이 파일 내용을 통째로 붙여넣고 실행해줘.
-- 기존에 products 테이블을 이미 만들었다면, 먼저 drop table products cascade; 로 지우고 다시 실행해줘.

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  stock integer,
  category text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table products enable row level security;

create policy "anyone can read products"
on products for select
using (true);

create policy "anyone can update products"
on products for update
using (true);

create or replace function sell_product(p_id uuid, p_qty integer)
returns boolean
language plpgsql
as $$
declare
  current_stock integer;
begin
  select stock into current_stock from products where id = p_id for update;

  if current_stock is null then
    return true;
  end if;

  if current_stock < p_qty then
    return false;
  end if;

  update products set stock = stock - p_qty where id = p_id;
  return true;
end;
$$;

create or replace function return_product(p_id uuid, p_qty integer)
returns boolean
language plpgsql
as $$
declare
  is_unlimited boolean;
begin
  select stock is null into is_unlimited from products where id = p_id;

  if is_unlimited then
    return true;
  end if;

  update products set stock = stock + p_qty where id = p_id;
  return true;
end;
$$;

alter publication supabase_realtime add table products;

insert into products (name, price, stock, category, sort_order) values
  ('개인 포토카드 (1장)', 10000, null, 'personal', 1),
  ('FTISLAND', 30000, 200, 'group', 1),
  ('N.Flying', 50000, 250, 'group', 2),
  ('Inseong(3pcs)', 30000, 40, 'group', 3),
  ('Hi-Fi Un!corn', 50000, 30, 'group', 4),
  ('AxMxP', 40000, 40, 'group', 5),
  ('LOVE FNC 반다나 (Bandana)', 20000, 200, 'goods', 1),
  ('LOVE FNC 슬로건 (Slogan)', 18000, 100, 'goods', 2),
  ('LOVE FNC 스티커 (Sticker)', 2000, 200, 'goods', 3),
  ('뽑기판 (1회)', 5000, 1000, 'draw', 1);
