\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- seed as the server (service role / no JWT)
insert into site.staff(email,name,roles) values ('fam@wearecalledtocare.com','Fam','{family}'),('com@gmail.com','Committee','{committee}'),('old@gmail.com','Expired','{committee}'),('rev@x.com','Reviewer','{scholarship}');
update site.staff set expires_on = current_date - 1 where email='old@gmail.com';
insert into site.contacts(id,email,first_name,last_name) values ('00000000-0000-0000-0000-000000000001','fam1@x.com','Ann','Family'),('00000000-0000-0000-0000-000000000002','spon@x.com','Bob','Sponsor');
insert into site.submissions(form,contact_id,data) values ('placement','00000000-0000-0000-0000-000000000001','{"kids":2}'),('camp',null,'{"youth":"A."}'),('message',null,'{}');
insert into site.sponsorships(contact_id,year,sponsor_name,level,amount,status) values ('00000000-0000-0000-0000-000000000002',2026,'Bob Co','Gold',10000,'Paid in Full');
insert into site.payments(provider,provider_id,purpose,amount,status) values ('stripe','pi_1','donation',50,'succeeded'),('stripe','pi_2','sponsorship',10000,'succeeded');

set role authenticated;
\echo '-- family care sees placements only, not camp-free sections like messages; no contacts'
set test.email='fam@wearecalledtocare.com';
select 'fam submissions', string_agg(form,',' order by form) from site.submissions;
select 'fam contacts', count(*) from site.contacts;
select 'fam payments', count(*) from site.payments;
\echo '-- committee sees sponsors and only contacts with dinner history'
set test.email='com@gmail.com';
select 'com submissions', count(*) from site.submissions;
select 'com contacts', string_agg(first_name,',') from site.contacts;
select 'com sponsorships', count(*) from site.sponsorships;
update site.sponsorships set amount=1;
select 'com edit blocked', amount from site.sponsorships;
\echo '-- expired committee member sees nothing'
set test.email='old@gmail.com';
select 'expired', count(*) from site.sponsorships;
\echo '-- reviewer (notes level) can add notes but not change status'
set test.email='rev@x.com';
update site.submissions set notes='[{"text":"looks good"}]' where form='camp';
select 'notes saved', notes->0->>'text' from site.submissions where form='camp';
update site.submissions set status='Approved' where form='camp';
\echo '-- non-owner cannot grant access'
insert into site.staff(email,roles) values ('hacker@x.com','{owner}');
\echo '-- owner sees everything, manages staff, cannot remove own owner'
set test.email='phil@wearecalledtocare.com';
select 'owner submissions', count(*) from site.submissions;
select 'owner payments', count(*) from site.payments;
insert into site.staff(email,name,roles) values ('new@wearecalledtocare.com','New','{staff}');
select 'staff count', count(*) from site.staff;
update site.staff set roles='{staff}' where email='phil@wearecalledtocare.com';
select 'me()', site.me()->>'name', site.me()->'perms'->>'payments';
\echo '-- strangers and anonymous see nothing'
set test.email='random@gmail.com';
select 'stranger', count(*) from site.submissions;
select 'stranger me', site.me() is null;
reset role;
set role anon;
select 'anon', count(*) from site.submissions;
reset role;
select 'audit rows', count(*) from site.audit;
select 'receipt', site.next_receipt() like 'C2C-%';
