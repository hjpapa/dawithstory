-- Only public participant speech can earn points, including re-awards.
create or replace function private.validate_praise_award() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status='awarded' and not exists(
   select 1 from public.messages m where m.id=new.message_id
   and m.room_id=new.room_id and m.member_id=new.member_id
   and m.role='member' and m.visibility='visible'
 ) then raise exception '공개된 참여자 발언에만 칭찬 별을 줄 수 있어요.'; end if;
 if length(btrim(new.reason))=0 then raise exception '칭찬 한마디를 입력해 주세요.'; end if;
 return new;
end $$;
revoke all on function private.validate_praise_award() from public,anon,authenticated;
drop trigger if exists validate_praise_award on public.praise;
create trigger validate_praise_award before insert or update on public.praise
for each row execute function private.validate_praise_award();
