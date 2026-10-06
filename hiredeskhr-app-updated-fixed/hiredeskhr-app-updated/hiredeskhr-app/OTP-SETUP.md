# OTP Setup — Email & WhatsApp

This is the guide for getting real verification codes delivered to each user's own
email address and phone number.

## Why you were seeing "Demo mode"

The screen was not lying to you and the code was not broken. `backend/.env` had:

```
SMTP_PASS=
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_ID=
```

All empty. No mail server and no WhatsApp gateway will accept a message without
credentials, so the backend generated the code, correctly refused to claim it had
been delivered, and showed you the amber banner.

Nothing in the app can send email or WhatsApp until you paste in credentials.
That part is unavoidable — but everything around it is now much easier, and several
real bugs that would have bitten you *after* you added credentials are fixed.

## The 2-minute path

From the project root:

```bash
npm run setup:otp
```

It asks for your Gmail address and App Password, optionally your WhatsApp
credentials, writes them to `backend/.env`, and sends a live test so you know it
worked before you open the app.

Check your configuration at any time:

```bash
npm run verify:otp

# or send a real test message
npm run verify:otp -- --email you@example.com --phone +919999999999
```

## Email setup (Gmail)

1. Turn on 2-Step Verification: https://myaccount.google.com/security
2. Create an App Password: https://myaccount.google.com/apppasswords
3. Put the 16-character value in `SMTP_PASS`.

Your normal Gmail password will never work — Google blocks it for SMTP.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your.address@gmail.com
SMTP_PASS=abcdefghijklmnop
FROM_EMAIL=your.address@gmail.com
```

This account is only the **sender**. The **recipient** is always whatever address
the user typed into the form.

If port 465 is blocked on your network (common on college and office Wi-Fi), set
`SMTP_PORT=587`. The backend now retries the other port automatically, and if it
still cannot connect it tells you so instead of failing silently.

No Gmail? Set `ELASTIC_EMAIL_API_KEY` instead — it works over plain HTTPS, so
blocked SMTP ports do not matter.

## WhatsApp setup (Meta Cloud API)

From https://developers.facebook.com → your app → WhatsApp → API Setup:

```
WHATSAPP_PHONE_ID=123456789012345     # the long numeric ID, NOT the phone number
WHATSAPP_API_TOKEN=EAAG...
```

Two things trip almost everyone up:

**1. Temporary tokens expire in 24 hours.** The token shown in the dashboard is a
test token. For anything lasting, create a System User token under Business
Settings → System Users → Generate Token, with the `whatsapp_business_messaging`
permission.

**2. You need an authentication template.** This is the big one. Meta refuses to
deliver a plain text message to anyone who has not messaged your business in the
last 24 hours — which describes every single person signing up. Without a
template, the API call looks like it succeeds and the message never arrives.

Create one in WhatsApp Manager → Message Templates → Create → Authentication, wait
for approval, then set:

```
WHATSAPP_OTP_TEMPLATE=your_template_name
WHATSAPP_OTP_TEMPLATE_LANG=en_US
```

The backend now sends via the template first and only falls back to plain text if
no template is configured.

**Also:** while your Meta app is in development mode, Meta only delivers to numbers
you have explicitly added under WhatsApp → API Setup → "To". Add your test number
there or you will get error 131030.

### Easier alternative

UltraMsg needs no Business account — you scan a QR code and get a token:

```
ULTRAMSG_INSTANCE_ID=instance12345
ULTRAMSG_TOKEN=your-token
```

It is used automatically if Meta is not configured or Meta fails.

## Checking what is wrong

The backend prints its delivery status at startup:

```
📧 Email OTP: READY via SMTP (you@gmail.com)
📱 WhatsApp OTP: NOT CONFIGURED -> run "npm run setup:otp"
```

And exposes a diagnostics endpoint:

```
GET  /api/auth/delivery-status?verify=true
POST /api/auth/test-delivery      { "email": "...", "phone": "..." }
```

Every failure now comes back with a `code` and a `hint` explaining the specific
fix, instead of a generic message.

## Meta error codes you may hit

| Code | What it means | Fix |
|---|---|---|
| 190 | Token invalid or expired | Generate a permanent System User token |
| 100 | Bad phone number ID | Copy the numeric Phone Number ID, not the phone number |
| 131030 | Recipient not on your allow-list | Add the number under API Setup → "To" |
| 131047 / 131026 | Outside the 24-hour window | Configure an authentication template |
| 132001 | Template not found | Check the exact name and language code |

## Working before credentials are ready

If **no** provider is configured and `NODE_ENV` is not `production`, the API returns
the generated code as `devOtp`, and the signup screen shows it in a dark panel you
can click to fill in. This keeps you unblocked while you sort out the Meta approval.

It switches off automatically the moment any provider is configured, and never
activates in production. To disable it entirely, set
`DISABLE_DEV_OTP_FALLBACK=true`.

## What else got fixed

- **`.env` was not being read at all** when the server was started from the project
  root (`npm start`). The loader resolved to `backend/dist/.env`, which does not
  exist — so even correct credentials would have been ignored. It now searches
  properly and prints which files it loaded.
- **Phone numbers were stored inconsistently.** Requesting a code with
  `8217877923` and verifying with `08217877923` created two different keys and the
  code would be rejected. All numbers now normalise to one E.164 form.
- **Resend was broken for WhatsApp-only signups** — it demanded an email address
  that channel never collects.
- **SMTP connections are pooled** with proper timeouts instead of a fresh
  connection per OTP, and credentials saved through the Settings UI now take effect
  without a server restart.
- **Failures now explain themselves** instead of surfacing raw driver errors.
