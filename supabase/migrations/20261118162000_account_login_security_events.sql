alter table public.account_security_events
 drop constraint account_security_events_event_type_check;
alter table public.account_security_events
 add constraint account_security_events_event_type_check
 check (event_type in (
  'login_succeeded','login_failed','session_ended',
  'otp_requested','otp_sent','otp_request_unavailable','otp_delivery_failed',
  'otp_verified','otp_verification_failed','password_changed','sessions_revoked',
  'rate_limit_exceeded','captcha_failed','ip_temporarily_blocked'
 ));
