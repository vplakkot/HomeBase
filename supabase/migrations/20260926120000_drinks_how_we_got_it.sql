-- How we got a drink (REQ-35, REQ-36) and whether each of us would buy it
-- again (REQ-34).
--
-- One field, not a feature each (a Notion decision of 2026-09-20): a
-- drink was Bought, a Gift, Had out, or is one we Want to try. The few
-- extras hang off it and are all optional: price and place for Bought,
-- who from for a Gift, where for Had out. Want to try is the wishlist;
-- changing it to Bought later keeps everything else about the drink.

alter table public.drinks
  add column how text not null default 'bought'
    check (how in ('bought', 'gift', 'had_out', 'want_to_try')),
  -- Free text with its currency ("€18", "$24.99"); nothing is converted.
  add column price text,
  -- Where it was bought, or where we had it out.
  add column place text,
  add column gift_from text,
  -- Each extra belongs to one value only, so changing the value can't
  -- leave a stale price on a gift.
  add constraint drinks_price_when_bought check (price is null or how = 'bought'),
  add constraint drinks_place_when_bought_or_out check (place is null or how in ('bought', 'had_out')),
  add constraint drinks_gift_from_when_gift check (gift_from is null or how = 'gift');

-- The default only filled in drinks added before this; from now on the
-- app always says which.
alter table public.drinks alter column how drop default;

-- REQ-34: yes, no, or not said (null), each person for themselves on
-- their own rating row, so the policies that keep a rating its owner's
-- cover it too. Separate from the stars: a 3-star wine can be a yes.
alter table public.drink_ratings
  add column buy_again boolean;

-- REQ-36: a wine we only want to try hasn't been had, so it can't be
-- rated yet. Change it to Bought, Gift or Had out first.
create function public.refuse_rating_untried()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.drinks where id = new.drink_id and how = 'want_to_try') then
    raise exception 'Want to try: change how we got it before rating';
  end if;
  return new;
end;
$$;

create trigger refuse_rating_untried
  before insert or update on public.drink_ratings
  for each row execute function public.refuse_rating_untried();
