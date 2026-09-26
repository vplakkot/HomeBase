-- Label photos (REQ-32): the front label, and the back if taken, kept
-- with the drink so we recognise the bottle in the shop.
--
-- The photos themselves live in Supabase Storage, in a private bucket:
-- nothing in it has a public address. The app hands out short-lived
-- signed links to members only. The drink row keeps where each photo is
-- (its path in the bucket); each photo has a small copy for the list
-- next to it, named the same with "-thumb" before ".jpg".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drink-labels', 'drink-labels', false, 1048576, array['image/jpeg']);

alter table public.drinks
  add column front_label text,
  add column back_label text,
  -- A back label only goes with a front one.
  add constraint drinks_back_needs_front check (back_label is null or front_label is not null);

-- Only household members see or change the photos (REQ-32: "visible
-- only to our household"). Everyone else, signed in or not, gets nothing.
create policy "members read drink labels"
  on storage.objects for select to authenticated
  using (bucket_id = 'drink-labels' and (select public.is_member()));

create policy "members add drink labels"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'drink-labels' and (select public.has_permission('use_modules')));

create policy "members replace drink labels"
  on storage.objects for update to authenticated
  using (bucket_id = 'drink-labels' and (select public.has_permission('use_modules')))
  with check (bucket_id = 'drink-labels' and (select public.has_permission('use_modules')));

create policy "members remove drink labels"
  on storage.objects for delete to authenticated
  using (bucket_id = 'drink-labels' and (select public.has_permission('use_modules')));
