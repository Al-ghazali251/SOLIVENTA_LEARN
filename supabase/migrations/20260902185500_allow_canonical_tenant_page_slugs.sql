alter table public.tenant_pages
  drop constraint if exists tenant_pages_slug_check;

alter table public.tenant_pages
  add constraint tenant_pages_slug_check
  check (
    slug = '/'
    or slug ~ '^/[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*/?$'
  );

