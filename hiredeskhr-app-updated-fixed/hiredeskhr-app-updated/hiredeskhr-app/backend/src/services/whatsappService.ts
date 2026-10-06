import { loadEnv, cleanSecret } from '../config/loadEnv';
loadEnv();

export interface WhatsAppConfig {
  apiToken?: string;
  phoneId?: string;
  ultraMsgInstanceId?: string;
  ultraMsgToken?: string;
  /** Name of the approved Meta AUTHENTICATION template used to deliver OTPs. */
  otpTemplate?: string;
  /** Language code of that template, e.g. en_US / en. */
  otpTemplateLang?: string;
  /** Default country code applied when the user types a bare local number. */
  defaultCountryCode?: string;
}

export const whatsappConfig: WhatsAppConfig = {
  apiToken: cleanSecret(process.env.WHATSAPP_API_TOKEN),
  phoneId: cleanSecret(process.env.WHATSAPP_PHONE_ID),
  ultraMsgInstanceId: cleanSecret(process.env.ULTRAMSG_INSTANCE_ID),
  ultraMsgToken: cleanSecret(process.env.ULTRAMSG_TOKEN),
  otpTemplate: (process.env.WHATSAPP_OTP_TEMPLATE || '').trim(),
  otpTemplateLang: (process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en_US').trim(),
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '')
};

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

export interface WhatsAppResult {
  success: boolean;
  dispatchedLive: boolean;
  phone: string;
  message: string;
  code?: string;
  hint?: string;
  provider?: 'meta-cloud' | 'ultramsg' | 'unconfigured';
  transport?: 'template' | 'text';
  whatsappLink?: string;
}

export interface ResolvedWaCreds {
  apiToken: string;
  phoneId: string;
  ultraMsgInstanceId: string;
  ultraMsgToken: string;
  otpTemplate: string;
  otpTemplateLang: string;
  defaultCountryCode: string;
  metaConfigured: boolean;
  ultraConfigured: boolean;
  anyConfigured: boolean;
}

/** Runtime config (Settings UI) wins over .env so changes apply without a restart. */
export function resolveWaCreds(): ResolvedWaCreds {
  const apiToken = cleanSecret(whatsappConfig.apiToken) || cleanSecret(process.env.WHATSAPP_API_TOKEN);
  const phoneId = cleanSecret(whatsappConfig.phoneId) || cleanSecret(process.env.WHATSAPP_PHONE_ID);
  const ultraMsgInstanceId = cleanSecret(whatsappConfig.ultraMsgInstanceId) || cleanSecret(process.env.ULTRAMSG_INSTANCE_ID);
  const ultraMsgToken = cleanSecret(whatsappConfig.ultraMsgToken) || cleanSecret(process.env.ULTRAMSG_TOKEN);

  return {
    apiToken,
    phoneId,
    ultraMsgInstanceId,
    ultraMsgToken,
    otpTemplate: (whatsappConfig.otpTemplate || process.env.WHATSAPP_OTP_TEMPLATE || '').trim(),
    otpTemplateLang: (whatsappConfig.otpTemplateLang || process.env.WHATSAPP_OTP_TEMPLATE_LANG || 'en_US').trim(),
    defaultCountryCode: (whatsappConfig.defaultCountryCode || process.env.DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, ''),
    metaConfigured: Boolean(apiToken && phoneId),
    ultraConfigured: Boolean(ultraMsgInstanceId && ultraMsgToken),
    anyConfigured: Boolean((apiToken && phoneId) || (ultraMsgInstanceId && ultraMsgToken))
  };
}

/**
 * Normalise a user-entered number into the digits-only E.164 form Meta expects.
 *  "+91 82178 77923" -> "918217877923"
 *  "08217877923"     -> "918217877923"  (leading 0 dropped, default CC added)
 *  "8217877923"      -> "918217877923"
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string {
  let digits = (input || '').replace(/[^0-9]/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) digits = digits.slice(2);
  while (digits.startsWith('0')) digits = digits.slice(1);

  // A bare national number (<= 10 digits) needs the country code prefixed.
  if (digits.length <= 10 && defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
    digits = `${defaultCountryCode}${digits}`;
  }

  return digits;
}

/**
 * Map Meta Cloud API error codes to an explanation a developer can act on.
 * These are the errors that make people think "my code is broken" when the
 * credentials are actually fine.
 */
function explainMetaError(resData: any, phone: string, creds: ResolvedWaCreds): { code: string; hint: string } {
  const err = resData?.error || {};
  const code = Number(err.code);
  const sub = Number(err.error_subcode);
  const msg = (err.message || '').toLowerCase();

  if (code === 190 || sub === 463 || msg.includes('access token')) {
    return {
      code: 'WA_TOKEN_INVALID',
      hint:
        'The WhatsApp access token is invalid or expired. Temporary tokens from the Meta dashboard last only 24 hours - ' +
        'create a permanent System User token (Business Settings -> System Users -> Generate Token, with the ' +
        'whatsapp_business_messaging permission) and put it in WHATSAPP_API_TOKEN.'
    };
  }

  if (code === 100 && msg.includes('phone_number_id')) {
    return {
      code: 'WA_PHONE_ID_INVALID',
      hint: `WHATSAPP_PHONE_ID ("${creds.phoneId}") is not a valid Phone Number ID. Copy it from WhatsApp Manager -> API Setup (it is a long numeric ID, NOT the phone number itself).`
    };
  }

  if (code === 131030) {
    return {
      code: 'WA_RECIPIENT_NOT_ALLOWED',
      hint: `+${phone} is not in your test recipient list. While your app is in development mode, Meta only delivers to numbers you explicitly add under WhatsApp -> API Setup -> "To". Add +${phone} there and verify it.`
    };
  }

  if (code === 131047 || code === 131026 || msg.includes('24 hour') || msg.includes('re-engagement')) {
    return {
      code: 'WA_OUTSIDE_SESSION_WINDOW',
      hint:
        `Meta blocked a free-form text to +${phone} because that user has not messaged you in the last 24 hours. ` +
        'This is the single most common reason OTPs silently fail. Create an AUTHENTICATION template in ' +
        'WhatsApp Manager -> Message Templates, wait for approval, then set WHATSAPP_OTP_TEMPLATE to its name.'
    };
  }

  if (code === 132001 || msg.includes('template name does not exist') || msg.includes('template not found')) {
    return {
      code: 'WA_TEMPLATE_NOT_FOUND',
      hint: `Template "${creds.otpTemplate}" (language ${creds.otpTemplateLang}) does not exist or is not approved. Check the exact name and language code in WhatsApp Manager -> Message Templates.`
    };
  }

  if (code === 131008 || code === 131009) {
    return {
      code: 'WA_BAD_REQUEST',
      hint: `Meta rejected the payload for +${phone}. Confirm the number is full international format with no "+", spaces or leading zeros.`
    };
  }

  if (code === 133010 || msg.includes('not registered')) {
    return {
      code: 'WA_PHONE_NOT_REGISTERED',
      hint: 'The sending phone number is not registered for Cloud API. Complete registration in WhatsApp Manager -> API Setup.'
    };
  }

  if (code === 80007 || code === 130429) {
    return { code: 'WA_RATE_LIMITED', hint: 'You have hit Meta messaging rate limits. Wait a few minutes and retry.' };
  }

  return {
    code: 'WA_SEND_FAILED',
    hint: `Meta returned error ${err.code || '?'}: ${err.message || 'unknown'}. Run "npm run verify:otp" for a full diagnostic.`
  };
}

async function postToMeta(creds: ResolvedWaCreds, body: any) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const resData: any = await response.json().catch(() => ({}));
  return { ok: response.ok, resData };
}

export class WhatsAppService {
  /**
   * Send the 6-digit OTP to the phone number the user typed in.
   *
   * Delivery strategy for Meta Cloud API:
   *   1. If WHATSAPP_OTP_TEMPLATE is set, send as an AUTHENTICATION template.
   *      This is the only reliable way to reach a user who has not messaged
   *      your business in the last 24 hours - which is every new signup.
   *   2. Otherwise (or if the template send fails) fall back to a free-form
   *      text message, which only works inside a 24h session window.
   */
  async sendWhatsAppOtp(phone: string, otp: string): Promise<WhatsAppResult> {
    const creds = resolveWaCreds();
    const cleanPhone = normalizePhone(phone, creds.defaultCountryCode);
    const whatsappLink = `https://api.whatsapp.com/send/?phone=${cleanPhone}`;
    const messageText = `${otp} is your HiredeskHR verification code. It expires in 5 minutes. Do not share this code with anyone.`;

    if (!cleanPhone || cleanPhone.length < 8) {
      return {
        success: false,
        dispatchedLive: false,
        phone: `+${cleanPhone}`,
        provider: 'unconfigured',
        code: 'INVALID_PHONE',
        message: `"${phone}" is not a usable phone number.`,
        hint: 'Enter the number in international format, e.g. +91 82178 77923.'
      };
    }

    console.log(`[WHATSAPP] -> +${cleanPhone} | meta=${creds.metaConfigured} ultra=${creds.ultraConfigured} template=${creds.otpTemplate || '(none)'}`);

    // ---- 1. Meta WhatsApp Cloud API --------------------------------------
    if (creds.metaConfigured) {
      // 1a. Authentication template (works for brand-new users)
      if (creds.otpTemplate) {
        try {
          const { ok, resData } = await postToMeta(creds, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'template',
            template: {
              name: creds.otpTemplate,
              language: { code: creds.otpTemplateLang },
              components: [
                { type: 'body', parameters: [{ type: 'text', text: otp }] },
                {
                  type: 'button',
                  sub_type: 'url',
                  index: '0',
                  parameters: [{ type: 'text', text: otp }]
                }
              ]
            }
          });

          if (ok && resData.messages) {
            console.log(`[WHATSAPP] template OTP delivered to +${cleanPhone} (${resData.messages[0]?.id})`);
            return {
              success: true,
              dispatchedLive: true,
              phone: `+${cleanPhone}`,
              provider: 'meta-cloud',
              transport: 'template',
              whatsappLink,
              message: `WhatsApp OTP delivered to +${cleanPhone} via the "${creds.otpTemplate}" template.`
            };
          }

          console.warn('[WHATSAPP] template send failed, trying free-form text:', JSON.stringify(resData?.error || resData));
        } catch (err: any) {
          console.warn(`[WHATSAPP] template request errored: ${err.message}`);
        }
      }

      // 1b. Free-form text (only valid inside a 24h customer-service window)
      try {
        const { ok, resData } = await postToMeta(creds, {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: { preview_url: false, body: messageText }
        });

        if (ok && resData.messages) {
          console.log(`[WHATSAPP] text OTP delivered to +${cleanPhone} (${resData.messages[0]?.id})`);
          return {
            success: true,
            dispatchedLive: true,
            phone: `+${cleanPhone}`,
            provider: 'meta-cloud',
            transport: 'text',
            whatsappLink,
            message: `WhatsApp OTP delivered to +${cleanPhone} via Meta Cloud API.`
          };
        }

        const explained = explainMetaError(resData, cleanPhone, creds);

        if (!creds.ultraConfigured) {
          return {
            success: false,
            dispatchedLive: false,
            phone: `+${cleanPhone}`,
            provider: 'meta-cloud',
            whatsappLink,
            message: `Meta Cloud API could not deliver to +${cleanPhone}: ${resData?.error?.message || 'unknown error'}`,
            ...explained
          };
        }
        console.warn('[WHATSAPP] Meta failed, falling back to UltraMsg...');
      } catch (err: any) {
        if (!creds.ultraConfigured) {
          return {
            success: false,
            dispatchedLive: false,
            phone: `+${cleanPhone}`,
            provider: 'meta-cloud',
            whatsappLink,
            code: 'WA_NETWORK_ERROR',
            message: `Network error contacting Meta Cloud API: ${err.message}`,
            hint: 'Check outbound internet access from the backend host (graph.facebook.com must be reachable).'
          };
        }
      }
    }

    // ---- 2. UltraMsg gateway ---------------------------------------------
    if (creds.ultraConfigured) {
      try {
        const params = new URLSearchParams({
          token: creds.ultraMsgToken,
          to: `+${cleanPhone}`,
          body: messageText
        });

        const response = await fetch(`https://api.ultramsg.com/${creds.ultraMsgInstanceId}/messages/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });

        const resData: any = await response.json().catch(() => ({}));

        if (resData.sent === 'true' || resData.sent === true || resData.id) {
          console.log(`[WHATSAPP] OTP delivered to +${cleanPhone} via UltraMsg`);
          return {
            success: true,
            dispatchedLive: true,
            phone: `+${cleanPhone}`,
            provider: 'ultramsg',
            transport: 'text',
            whatsappLink,
            message: `WhatsApp OTP delivered to +${cleanPhone} via UltraMsg.`
          };
        }

        return {
          success: false,
          dispatchedLive: false,
          phone: `+${cleanPhone}`,
          provider: 'ultramsg',
          whatsappLink,
          code: 'ULTRAMSG_REJECTED',
          message: `UltraMsg rejected the request: ${resData.error || resData.message || JSON.stringify(resData)}`,
          hint: 'Check the instance ID and token, and make sure the UltraMsg instance is connected (QR scanned) in their dashboard.'
        };
      } catch (err: any) {
        return {
          success: false,
          dispatchedLive: false,
          phone: `+${cleanPhone}`,
          provider: 'ultramsg',
          whatsappLink,
          code: 'ULTRAMSG_NETWORK_ERROR',
          message: `Network error contacting UltraMsg: ${err.message}`
        };
      }
    }

    // ---- 3. Nothing configured -------------------------------------------
    console.warn(
      `\n[WHATSAPP NOT CONFIGURED] Wanted to send an OTP to +${cleanPhone} but no gateway is set up.\n` +
        `  Fix: run "npm run setup:otp" from the project root, or set WHATSAPP_API_TOKEN + WHATSAPP_PHONE_ID in backend/.env.\n`
    );

    return {
      success: false,
      dispatchedLive: false,
      phone: `+${cleanPhone}`,
      provider: 'unconfigured',
      whatsappLink,
      code: 'WHATSAPP_NOT_CONFIGURED',
      message: `No WhatsApp gateway is configured, so nothing was sent to +${cleanPhone}.`,
      hint: 'Run "npm run setup:otp", or set WHATSAPP_API_TOKEN + WHATSAPP_PHONE_ID in backend/.env. UltraMsg is an easier alternative if you do not have a Meta Business account.'
    };
  }

  /** Check credentials without sending a message. */
  async verifyWhatsApp(): Promise<{ ok: boolean; message: string; code?: string; hint?: string }> {
    const creds = resolveWaCreds();

    if (!creds.anyConfigured) {
      return {
        ok: false,
        code: 'WHATSAPP_NOT_CONFIGURED',
        message: 'No WhatsApp gateway credentials are set.',
        hint: 'Run "npm run setup:otp" from the project root.'
      };
    }

    if (creds.metaConfigured) {
      try {
        const response = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${creds.phoneId}?fields=display_phone_number,verified_name,quality_rating`,
          { headers: { Authorization: `Bearer ${creds.apiToken}` } }
        );
        const data: any = await response.json().catch(() => ({}));

        if (!response.ok && !data?.error) {
          return {
            ok: false,
            code: 'WA_UNEXPECTED_RESPONSE',
            message: `Meta returned HTTP ${response.status} with no error body.`,
            hint: 'This usually means a proxy or firewall is intercepting the request. Confirm the backend can reach graph.facebook.com.'
          };
        }

        if (response.ok && data.id) {
          const templateNote = creds.otpTemplate
            ? `OTP template: "${creds.otpTemplate}" (${creds.otpTemplateLang}).`
            : 'No WHATSAPP_OTP_TEMPLATE is set, so OTPs will only reach users who messaged you in the last 24 hours.';
          return {
            ok: true,
            message: `Meta Cloud API reachable. Sending as ${data.display_phone_number || creds.phoneId} (${data.verified_name || 'unverified'}). ${templateNote}`,
            ...(creds.otpTemplate ? {} : { code: 'WA_NO_TEMPLATE', hint: templateNote })
          };
        }

        const explained = explainMetaError(data, '', creds);
        return { ok: false, message: data?.error?.message || 'Meta credential check failed', ...explained };
      } catch (err: any) {
        return { ok: false, code: 'WA_NETWORK_ERROR', message: `Could not reach graph.facebook.com: ${err.message}` };
      }
    }

    return { ok: true, message: `UltraMsg instance ${creds.ultraMsgInstanceId} configured.` };
  }
}

export const whatsappService = new WhatsAppService();
