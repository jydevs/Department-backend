/**
 * Default e-mail templates (Spanish). Seeded once; the admin can edit them afterwards and the seed never overwrites edits.
 *
 * Variables per template (flat names, all optional; a missing one renders empty). Always HTML-escaped in bodyHtml:
 *   order_confirmation : customerName, orderNumber, total, itemsSummary, orderUrl
 *   order_shipped      : customerName, orderNumber, carrier, trackingNumber, trackingUrl, orderUrl
 *   order_cancelled    : customerName, orderNumber, reason, orderUrl
 *   password_reset     : customerName, resetUrl, expiresInMinutes
 *   email_verify       : customerName, verifyUrl, expiresInHours
 *   welcome            : customerName, storeUrl
 *   refund_issued      : customerName, orderNumber, amount, orderUrl
 *   newsletter_confirm : confirmUrl, unsubscribeUrl
 *   account_exists     : customerName, resetUrl (link to the forgot-password page; carries no token)
 * Links (`*Url`) are built by the caller from STOREFRONT_URL.
 */

export const TEMPLATE_VARIABLES = {
  order_confirmation: ["customerName", "orderNumber", "total", "itemsSummary", "orderUrl"],
  order_shipped: ["customerName", "orderNumber", "carrier", "trackingNumber", "trackingUrl", "orderUrl"],
  order_cancelled: ["customerName", "orderNumber", "reason", "orderUrl"],
  password_reset: ["customerName", "resetUrl", "expiresInMinutes"],
  email_verify: ["customerName", "verifyUrl", "expiresInHours"],
  welcome: ["customerName", "storeUrl"],
  refund_issued: ["customerName", "orderNumber", "amount", "orderUrl"],
  newsletter_confirm: ["confirmUrl", "unsubscribeUrl"],
  account_exists: ["customerName", "resetUrl"],
} as const satisfies Record<string, readonly string[]>;

export type TemplateKey = keyof typeof TEMPLATE_VARIABLES;

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_VARIABLES) as TemplateKey[];

export function isTemplateKey(key: string): key is TemplateKey {
  return Object.hasOwn(TEMPLATE_VARIABLES, key);
}

/** Sample values for previews and test sends. */
export const SAMPLE_DATA: Record<TemplateKey, Record<string, string>> = {
  order_confirmation: { customerName: "Ana", orderNumber: "DD-1001", total: "$250.000", itemsSummary: "2 x Camiseta Oversize", orderUrl: "https://example.com/pedidos/DD-1001" },
  order_shipped: { customerName: "Ana", orderNumber: "DD-1001", carrier: "Servientrega", trackingNumber: "SV123456", trackingUrl: "https://example.com/rastreo/SV123456", orderUrl: "https://example.com/pedidos/DD-1001" },
  order_cancelled: { customerName: "Ana", orderNumber: "DD-1001", reason: "Cancelado a solicitud del cliente", orderUrl: "https://example.com/pedidos/DD-1001" },
  password_reset: { customerName: "Ana", resetUrl: "https://example.com/restablecer?token=ejemplo", expiresInMinutes: "60" },
  email_verify: { customerName: "Ana", verifyUrl: "https://example.com/verificar?token=ejemplo", expiresInHours: "48" },
  welcome: { customerName: "Ana", storeUrl: "https://example.com" },
  refund_issued: { customerName: "Ana", orderNumber: "DD-1001", amount: "$250.000", orderUrl: "https://example.com/pedidos/DD-1001" },
  newsletter_confirm: { confirmUrl: "https://example.com/newsletter/confirmar?token=ejemplo", unsubscribeUrl: "https://example.com/newsletter/baja?token=ejemplo" },
  account_exists: { customerName: "Ana", resetUrl: "https://example.com/account/forgot-password" },
};

export interface DefaultTemplate {
  key: TemplateKey;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

const layout = (heading: string, content: string): string =>
  `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;"><tr><td align="center">` +
  `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;padding:32px;">` +
  `<tr><td style="font-size:20px;font-weight:bold;padding-bottom:16px;">Daregular Dept.</td></tr>` +
  `<tr><td style="font-size:18px;font-weight:bold;padding-bottom:12px;">${heading}</td></tr>` +
  `<tr><td style="font-size:15px;line-height:1.6;">${content}</td></tr>` +
  `<tr><td style="font-size:12px;color:#71717a;padding-top:24px;">Este es un mensaje automático de Daregular Dept.</td></tr>` +
  `</table></td></tr></table></body></html>`;

const button = (href: string, label: string): string =>
  `<p style="margin:24px 0;"><a href="${href}" style="background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;">${label}</a></p>`;

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: "order_confirmation",
    subject: "Confirmación de tu pedido {{ orderNumber }}",
    bodyHtml: layout(
      "¡Gracias por tu compra!",
      `<p>Hola {{ customerName }}, recibimos tu pedido <strong>{{ orderNumber }}</strong>.</p><p>{{ itemsSummary }}</p><p>Total: <strong>{{ total }}</strong></p>${button("{{ orderUrl }}", "Ver mi pedido")}`,
    ),
    bodyText: "Hola {{ customerName }}, recibimos tu pedido {{ orderNumber }}.\n\n{{ itemsSummary }}\nTotal: {{ total }}\n\nVer tu pedido: {{ orderUrl }}\n",
  },
  {
    key: "order_shipped",
    subject: "Tu pedido {{ orderNumber }} va en camino",
    bodyHtml: layout(
      "Tu pedido va en camino",
      `<p>Hola {{ customerName }}, tu pedido <strong>{{ orderNumber }}</strong> fue enviado con {{ carrier }}.</p><p>Guía: <strong>{{ trackingNumber }}</strong></p>${button("{{ trackingUrl }}", "Rastrear envío")}<p><a href="{{ orderUrl }}">Ver mi pedido</a></p>`,
    ),
    bodyText: "Hola {{ customerName }}, tu pedido {{ orderNumber }} fue enviado con {{ carrier }}.\nGuía: {{ trackingNumber }}\nRastreo: {{ trackingUrl }}\nPedido: {{ orderUrl }}\n",
  },
  {
    key: "order_cancelled",
    subject: "Tu pedido {{ orderNumber }} fue cancelado",
    bodyHtml: layout(
      "Pedido cancelado",
      `<p>Hola {{ customerName }}, tu pedido <strong>{{ orderNumber }}</strong> fue cancelado.</p><p>Motivo: {{ reason }}</p>${button("{{ orderUrl }}", "Ver mi pedido")}`,
    ),
    bodyText: "Hola {{ customerName }}, tu pedido {{ orderNumber }} fue cancelado.\nMotivo: {{ reason }}\n\nPedido: {{ orderUrl }}\n",
  },
  {
    key: "password_reset",
    subject: "Restablece tu contraseña",
    bodyHtml: layout(
      "Restablecer contraseña",
      `<p>Hola {{ customerName }}, recibimos una solicitud para restablecer tu contraseña.</p>${button("{{ resetUrl }}", "Crear nueva contraseña")}<p>El enlace vence en {{ expiresInMinutes }} minutos y solo se puede usar una vez. Si no fuiste tú, ignora este mensaje.</p>`,
    ),
    bodyText: "Hola {{ customerName }}, recibimos una solicitud para restablecer tu contraseña.\n\nEnlace: {{ resetUrl }}\n\nVence en {{ expiresInMinutes }} minutos y solo se puede usar una vez. Si no fuiste tú, ignora este mensaje.\n",
  },
  {
    key: "email_verify",
    subject: "Verifica tu correo",
    bodyHtml: layout(
      "Verifica tu correo",
      `<p>Hola {{ customerName }}, confirma tu correo para activar tu cuenta.</p>${button("{{ verifyUrl }}", "Verificar correo")}<p>El enlace vence en {{ expiresInHours }} horas.</p>`,
    ),
    bodyText: "Hola {{ customerName }}, confirma tu correo para activar tu cuenta.\n\nEnlace: {{ verifyUrl }}\n\nVence en {{ expiresInHours }} horas.\n",
  },
  {
    key: "welcome",
    subject: "Te damos la bienvenida a Daregular Dept.",
    bodyHtml: layout(
      "¡Bienvenido/a, {{ customerName }}!",
      `<p>Tu cuenta está lista. Explora las novedades cuando quieras.</p>${button("{{ storeUrl }}", "Ir a la tienda")}`,
    ),
    bodyText: "¡Bienvenido/a, {{ customerName }}! Tu cuenta está lista.\n\nVisita la tienda: {{ storeUrl }}\n",
  },
  {
    key: "refund_issued",
    subject: "Reembolso de tu pedido {{ orderNumber }}",
    bodyHtml: layout(
      "Reembolso emitido",
      `<p>Hola {{ customerName }}, emitimos un reembolso de <strong>{{ amount }}</strong> por tu pedido <strong>{{ orderNumber }}</strong>.</p><p>Según tu banco, puede tardar unos días en reflejarse.</p>${button("{{ orderUrl }}", "Ver mi pedido")}`,
    ),
    bodyText: "Hola {{ customerName }}, emitimos un reembolso de {{ amount }} por tu pedido {{ orderNumber }}.\nPuede tardar unos días en reflejarse.\n\nPedido: {{ orderUrl }}\n",
  },
  {
    key: "newsletter_confirm",
    subject: "Confirma tu suscripción",
    bodyHtml: layout(
      "Confirma tu suscripción",
      `<p>Para recibir nuestras novedades, confirma tu suscripción.</p>${button("{{ confirmUrl }}", "Confirmar suscripción")}<p style="font-size:12px;color:#71717a;">Si no lo solicitaste, ignora este mensaje o <a href="{{ unsubscribeUrl }}">cancela aquí</a>.</p>`,
    ),
    bodyText: "Para recibir nuestras novedades, confirma tu suscripción:\n{{ confirmUrl }}\n\nSi no lo solicitaste, ignora este mensaje o cancela aquí: {{ unsubscribeUrl }}\n",
  },
  {
    key: "account_exists",
    subject: "Ya tienes una cuenta en Daregular Dept.",
    bodyHtml: layout(
      "Ya tienes una cuenta",
      `<p>Hola {{ customerName }}, alguien intentó crear una cuenta con este correo, pero ya existe una asociada a él.</p><p>Si fuiste tú y no recuerdas tu contraseña, puedes restablecerla aquí:</p>${button("{{ resetUrl }}", "Restablecer contraseña")}<p>Si no fuiste tú, ignora este mensaje: tu cuenta no ha cambiado.</p>`,
    ),
    bodyText: "Hola {{ customerName }}, alguien intentó crear una cuenta con este correo, pero ya existe una asociada a él.\n\nSi fuiste tú y no recuerdas tu contraseña, puedes restablecerla aquí: {{ resetUrl }}\n\nSi no fuiste tú, ignora este mensaje: tu cuenta no ha cambiado.\n",
  },
];
