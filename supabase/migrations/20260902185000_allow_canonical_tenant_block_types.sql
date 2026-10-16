alter table public.tenant_page_blocks
  drop constraint if exists tenant_page_blocks_block_type_check;

alter table public.tenant_page_blocks
  add constraint tenant_page_blocks_block_type_check
  check (block_type ~ '^[a-z][A-Za-z0-9-]{1,80}$');

