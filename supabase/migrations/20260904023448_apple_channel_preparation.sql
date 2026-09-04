-- Compatibility only: this does not enable Apple ingress, delivery or client write access.
-- Apply after the command-queue migration. Existing grants and RLS policies are unchanged.
begin;
alter table channel_links drop constraint channel_links_channel_check;
alter table channel_links add constraint channel_links_channel_check check (channel in ('telegram','whatsapp','slack','sms','email','apple'));
alter table chat_messages drop constraint chat_messages_channel_check;
alter table chat_messages add constraint chat_messages_channel_check check (channel in ('app','telegram','whatsapp','slack','sms','email','apple'));
alter table outbound_messages drop constraint outbound_messages_channel_check;
alter table outbound_messages add constraint outbound_messages_channel_check check (channel in ('telegram','whatsapp','slack','sms','email','apple'));
alter table routine_commands drop constraint routine_commands_channel_check;
alter table routine_commands add constraint routine_commands_channel_check check (channel in ('app','telegram','whatsapp','slack','sms','email','apple'));
commit;
