# Live testing, email OTP and hosting

## Email OTP configuration

Hospital AI OS supports two second-factor modes:

- Authenticator-app TOTP is the default for clinical and platform accounts.
- Emailed login OTP is optional. Set `LOGIN_OTP_CHANNEL=email` only after transactional email works.

Password recovery automatically uses emailed OTP when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Codes contain six digits, expire after ten minutes, allow five attempts and work once. A verified code becomes a short-lived, single-use password-reset token. Password reset ends every existing session.

Render environment variables:

```text
RESEND_API_KEY=re_...
EMAIL_FROM=Hospital AI OS <security@your-verified-domain.in>
LOGIN_OTP_CHANNEL=email
```

Verify the sending domain in Resend before enabling email login codes. Keep `LOGIN_OTP_CHANNEL` unset until a recovery message reaches a real test inbox; otherwise protected users will be unable to sign in.

## Hosting decision

### Demonstration with synthetic data

The existing free Render service is acceptable. Expect an idle cold start and complete loss of local SQLite data on a restart, spin-down or redeploy. Recreate the demonstration data when needed.

### Free persistent technical test

Oracle Cloud Always Free is the closest fit for the current SQLite architecture because it supplies a VM and persistent block volume. It requires operating the server, TLS, firewall, patching, monitoring and backups yourself, and free capacity is not always available.

### Real patient pilot

Do not use free hosting. Use a paid service with persistent encrypted storage, off-site backups, monitoring, support and contractual privacy terms. The current simplest deployment is one paid Render web service with a persistent encrypted disk, followed by managed PostgreSQL before public multi-tenant scale.

## Real-time pilot sequence

1. **Synthetic rehearsal:** enable demo data and complete registration, admission, transfer, vitals, laboratory, discharge, calling, escalation, export and restore scenarios.
2. **Hospital configuration:** create a separate tenant, disable demo data, enter the hospital's departments and staff, require MFA, configure encrypted storage and verify backups.
3. **De-identified shadow run:** use invented identifiers or data formally de-identified by the hospital. Staff operate Hospital AI OS alongside the existing system; it is not the source of truth.
4. **Limited live pilot:** proceed only with a hospital agreement, privacy notice, consent and incident-response owner. Enrol a small cohort who have explicitly consented. Exclude emergency care and autonomous clinical decisions.
5. **Daily reconciliation:** compare every appointment, admission, medication, lab result, escalation and discharge against the hospital's source system. Record discrepancies and stop the affected workflow until resolved.
6. **Recovery exercise:** restore an encrypted backup to a separate environment and prove the selected cohort is complete before expanding.
7. **Exit review:** hospital clinical, privacy and IT owners sign off availability, accuracy, access, retention, deletion and incident handling before the cohort grows.

Never copy an existing hospital database into the free demonstration deployment. Use the import template only after data minimisation, mapping review and written authorization.
