/**
 * Textos de las páginas legales (BORRADORES). Redactados para una tienda en línea colombiana (Daregular Dept.).
 *
 * IMPORTANTE: son plantillas de partida, NO asesoría legal. Deben ser revisadas y ajustadas por un abogado antes
 * de publicarse en producción. Todo dato del negocio que falte aparece como `[COMPLETAR: ...]` y se rellena
 * editando `BUSINESS` (en scripts/complete-storefront.ts) o directamente en /admin/content/pages.
 *
 * Formato: el Markdown que entiende la tienda (src/components/ui/Markdown.tsx): párrafos, listas con "- ",
 * subtítulos "### " (cada uno en su propio párrafo), **negrita** y *cursiva*. Sin HTML, sin listas numeradas ni tablas.
 * Cada sección `rich-text` admite máximo 5000 caracteres (se valida al construir).
 */

export interface Business {
  razonSocial: string;
  nit: string;
  direccion: string;
  ciudad: string;
  correo: string;
  telefono: string;
  /** Dominio público de la tienda (sin barra final). */
  sitioWeb: string;
  /** Fecha de la última actualización de los textos (texto libre). */
  vigencia: string;
}

export interface ShippingRateInfo {
  name: string;
  price: number;
  minDays: number | null;
  maxDays: number | null;
  freeOverSubtotal: number | null;
}
export interface ShippingZoneInfo {
  name: string;
  departments: string[];
  rates: ShippingRateInfo[];
}

export interface LegalSection {
  id: string;
  type: "page-header" | "rich-text";
  enabled: true;
  settings: Record<string, unknown>;
}

export interface LegalPage {
  handle: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  /** Texto del enlace en el pie de página. */
  footerLabel: string;
  sections: LegalSection[];
}

export const MAX_RICH_TEXT = 5000;

const cop = (n: number) => `$${new Intl.NumberFormat("es-CO").format(n)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function days(min: number | null, max: number | null): string {
  if (min === null && max === null) return "plazo por confirmar";
  if (min !== null && max !== null) return min === max ? `${min} ${plural(min, "día hábil", "días hábiles")}` : `${min} a ${max} días hábiles`;
  return `${min ?? max} ${plural((min ?? max) as number, "día hábil", "días hábiles")}`;
}

const header = (id: string, heading: string, text: string, lead?: string): LegalSection => ({
  id,
  type: "page-header",
  enabled: true,
  settings: { eyebrow: "Legal", heading, ...(lead ? { lead } : {}), text, alignment: "left" },
});

const block = (id: string, heading: string, body: string): LegalSection => {
  const trimmed = body.trim();
  if (trimmed.length > MAX_RICH_TEXT) throw new Error(`Sección legal "${id}" demasiado larga (${trimmed.length} > ${MAX_RICH_TEXT})`);
  return { id, type: "rich-text", enabled: true, settings: { heading, body: trimmed, alignment: "left", maxWidth: "normal" } };
};

const DRAFT_NOTICE = (b: Business) => `Borrador pendiente de revisión legal · Vigencia: ${b.vigencia}`;

/* ─────────────────────────────── Términos y condiciones ─────────────────────────────── */

function terms(b: Business): LegalPage {
  return {
    handle: "terminos-y-condiciones",
    title: "Términos y condiciones",
    seoTitle: "Términos y condiciones",
    seoDescription: "Condiciones de uso del sitio y de compra en Daregular Dept.: pedidos, precios, pagos, envíos, cambios y devoluciones.",
    footerLabel: "Términos y condiciones",
    sections: [
      header("terms-header", "Términos y condiciones", DRAFT_NOTICE(b)),
      block(
        "terms-1",
        "1. Quiénes somos y alcance",
        `
Este sitio web es operado por **${b.razonSocial}**, identificada con NIT ${b.nit}, con domicilio en ${b.direccion}, ${b.ciudad}, Colombia (en adelante, "Daregular Dept." o "la tienda"). Puedes escribirnos a ${b.correo} o al teléfono ${b.telefono}.

Estos términos regulan el acceso y uso del sitio ${b.sitioWeb} y las compras que realices a través de él. Al navegar, crear una cuenta o hacer un pedido aceptas estos términos, la [Política de privacidad](/pages/politica-de-privacidad) y las políticas de [envíos y devoluciones](/pages/envios-y-devoluciones) y de [cambios y garantías](/pages/cambios-y-garantias). Si no estás de acuerdo, te pedimos no usar el sitio.

Para comprar debes ser mayor de edad (18 años) y tener capacidad legal para contratar. Si eres menor, la compra debe ser realizada por tu padre, madre o representante legal.
`,
      ),
      block(
        "terms-2",
        "2. Productos, precios y disponibilidad",
        `
Describimos y fotografiamos nuestros productos con la mayor exactitud posible. Los colores pueden variar levemente según la pantalla de tu dispositivo. Las tallas se indican en cada producto; si tienes dudas, escríbenos antes de comprar.

Los precios se expresan en pesos colombianos (COP) y ${"[COMPLETAR: indicar si los precios incluyen IVA u otros impuestos]"}. Los costos de envío se muestran por separado en el momento de pagar, antes de confirmar el pedido.

Todos los productos están sujetos a disponibilidad. Si un producto se agota o hay un error evidente de precio o de inventario, podremos cancelar o ajustar el pedido; en ese caso te lo informaremos y, si ya pagaste, te reembolsaremos el valor íntegro por el mismo medio de pago.

Las promociones, códigos de descuento y envíos gratis tienen las condiciones indicadas en cada oferta, no son acumulables salvo que se indique lo contrario y pueden cambiar o terminar sin previo aviso.
`,
      ),
      block(
        "terms-3",
        "3. Pedidos y pagos",
        `
Un pedido se considera aceptado cuando recibes la confirmación por correo electrónico y el pago ha sido aprobado. Hasta entonces, los productos no están reservados de forma definitiva.

Aceptamos los medios de pago habilitados en el proceso de compra, que se procesan a través de una pasarela de pagos de un tercero (actualmente ${"[COMPLETAR: confirmar la pasarela de pagos, p. ej. Wompi]"}). Los datos de tu tarjeta o cuenta se ingresan directamente en la pasarela y la tienda no los almacena.

Nos reservamos el derecho de verificar la información del pedido y del pago, y de cancelar operaciones que parezcan fraudulentas o que no puedan ser validadas por la entidad financiera.

Eres responsable de que los datos que nos entregas (nombre, documento, dirección, teléfono y correo) sean correctos y estén completos. Los errores en la dirección de entrega pueden generar demoras o costos adicionales.
`,
      ),
      block(
        "terms-4",
        "4. Envíos, entrega y riesgo",
        `
Despachamos a todo el territorio colombiano. Los plazos, tarifas y condiciones se explican en la política de [envíos y devoluciones](/pages/envios-y-devoluciones). Los plazos son estimados y comienzan a contarse una vez el pago está aprobado.

El riesgo de pérdida o daño del producto pasa a ti en el momento en que lo recibes. Al recibir el paquete revisa que esté en buen estado; si presenta daños visibles, déjalo indicado ante la transportadora y avísanos dentro de las 48 horas siguientes a ${"[COMPLETAR: confirmar plazo para reportar novedades en la entrega]"}.
`,
      ),
      block(
        "terms-5",
        "5. Derecho de retracto, cambios y garantía",
        `
Como compras a distancia, tienes **derecho de retracto** conforme al artículo 47 de la Ley 1480 de 2011 (Estatuto del Consumidor): puedes retractarte de la compra dentro de los **cinco (5) días hábiles** siguientes a la entrega del producto, sin necesidad de explicar tus razones, siempre que el producto se devuelva en las condiciones y por las vías descritas en nuestra política de [envíos y devoluciones](/pages/envios-y-devoluciones).

También ofrecemos cambios por talla y respondemos por la garantía legal de los productos, en los términos de la política de [cambios y garantías](/pages/cambios-y-garantias).

Estos derechos no excluyen los demás que la ley reconoce a los consumidores.
`,
      ),
      block(
        "terms-6",
        "6. Propiedad intelectual y uso del sitio",
        `
Las marcas, nombres comerciales, logotipos, diseños, estampados, fotografías, textos y demás contenidos del sitio pertenecen a ${b.razonSocial} o a sus licenciantes y están protegidos por las normas de propiedad intelectual. No puedes copiarlos, reproducirlos, modificarlos ni usarlos con fines comerciales sin autorización previa y por escrito.

Te comprometes a usar el sitio de forma lícita y a no: (i) intentar acceder sin autorización a sistemas o cuentas de terceros; (ii) introducir virus o código malicioso; (iii) usar medios automatizados para extraer contenido o saturar el servicio; (iv) suplantar a otra persona.

Eres responsable de mantener la confidencialidad de tu contraseña y de la actividad realizada desde tu cuenta. Si sospechas un uso no autorizado, avísanos de inmediato a ${b.correo}.
`,
      ),
      block(
        "terms-7",
        "7. Responsabilidad, modificaciones y ley aplicable",
        `
Hacemos nuestro mejor esfuerzo para que el sitio esté disponible y libre de errores, pero no garantizamos un funcionamiento ininterrumpido. En la medida permitida por la ley, no respondemos por daños indirectos derivados de interrupciones del servicio ajenas a nuestro control. Nada de lo dispuesto aquí limita la responsabilidad que la ley no permita excluir.

Podemos modificar estos términos en cualquier momento. La versión vigente es la publicada en esta página y se aplica a los pedidos realizados después de su publicación.

Estos términos se rigen por las leyes de la República de Colombia. Cualquier diferencia se intentará resolver primero de manera directa y amistosa; también puedes acudir a la Superintendencia de Industria y Comercio (SIC) como autoridad de protección al consumidor y a la jurisdicción competente.

**Peticiones, quejas y reclamos:** escríbenos a ${b.correo}. Responderemos dentro de los plazos legales.
`,
      ),
    ],
  };
}

/* ─────────────────────────────── Política de privacidad ─────────────────────────────── */

function privacy(b: Business): LegalPage {
  return {
    handle: "politica-de-privacidad",
    title: "Política de privacidad",
    seoTitle: "Política de privacidad y tratamiento de datos personales",
    seoDescription: "Cómo Daregular Dept. trata tus datos personales: finalidades, derechos como titular (habeas data), canal de ejercicio y cookies. Ley 1581 de 2012.",
    footerLabel: "Política de privacidad",
    sections: [
      header("privacy-header", "Política de privacidad", DRAFT_NOTICE(b), "Tratamiento de datos personales."),
      block(
        "privacy-1",
        "1. Responsable del tratamiento",
        `
En cumplimiento de la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y demás normas sobre protección de datos personales (habeas data), te informamos quién es el responsable de tus datos:

- **Responsable:** ${b.razonSocial}
- **NIT:** ${b.nit}
- **Domicilio:** ${b.direccion}, ${b.ciudad}, Colombia
- **Correo para asuntos de datos personales:** ${b.correo}
- **Teléfono:** ${b.telefono}
- **Sitio web:** ${b.sitioWeb}

Esta política aplica a los datos personales que recolectamos a través del sitio web, del proceso de compra, del formulario de contacto, del boletín y de nuestros canales de atención.
`,
      ),
      block(
        "privacy-2",
        "2. Datos que recolectamos",
        `
Recolectamos únicamente los datos necesarios para las finalidades descritas:

- **Datos de identificación y contacto:** nombre, número de documento (cuando es necesario para facturar o despachar), correo electrónico, teléfono.
- **Datos de entrega y facturación:** dirección, ciudad, departamento y datos de quien recibe.
- **Datos de la compra:** productos, valores, medio de pago utilizado y estado del pedido. No almacenamos el número completo de tu tarjeta ni su código de seguridad: se ingresan directamente en la pasarela de pagos.
- **Datos de cuenta:** correo, contraseña (guardada de forma cifrada) e historial de pedidos.
- **Datos de navegación:** dirección IP, tipo de dispositivo y navegador, páginas visitadas y cookies (ver sección 7).
- **Mensajes:** lo que nos escribes por el formulario de contacto u otros canales.

No solicitamos **datos sensibles** (salud, origen racial, orientación sexual, convicciones políticas o religiosas, datos biométricos, etc.). Si alguna vez los necesitáramos, sería opcional y con tu autorización expresa.
`,
      ),
      block(
        "privacy-3",
        "3. Finalidades del tratamiento",
        `
Usamos tus datos para:

- Crear y administrar tu cuenta y atender tus pedidos: procesar el pago, preparar, despachar y entregar los productos, facturar y gestionar cambios, devoluciones y garantías.
- Atender tus peticiones, quejas, reclamos y consultas.
- Enviarte comunicaciones del servicio (confirmaciones, estado del pedido, avisos importantes).
- Enviarte novedades, lanzamientos y promociones, **solo si te suscribes o lo autorizas**; puedes darte de baja en cualquier momento desde el enlace incluido en cada mensaje.
- Prevenir fraudes y garantizar la seguridad del sitio y de las transacciones.
- Cumplir obligaciones legales, contables, tributarias y requerimientos de autoridades competentes.
- Mejorar el sitio, medir su uso y entender qué productos y contenidos te interesan, preferiblemente con datos agregados.

No vendemos tus datos personales. Si llegamos a usarlos para una finalidad distinta, te pediremos una nueva autorización.
`,
      ),
      block(
        "privacy-4",
        "4. Autorización, encargados y transferencias",
        `
Tratamos tus datos con tu **autorización previa, expresa e informada**, que obtenemos cuando creas tu cuenta, haces un pedido, te suscribes al boletín o nos escribes. Puedes revocarla cuando quieras, salvo cuando exista un deber legal o contractual de conservar la información.

Para operar, compartimos los datos estrictamente necesarios con terceros que actúan como **encargados** o proveedores bajo deberes de confidencialidad y seguridad: pasarela de pagos, transportadoras y operadores logísticos, proveedores de alojamiento y tecnología, servicios de envío de correo electrónico y herramientas de analítica. ${"[COMPLETAR: listar los proveedores reales: pasarela de pagos, transportadora, hosting, correo, analítica]"}

Algunos de estos proveedores pueden almacenar o procesar información fuera de Colombia. En esos casos exigimos niveles adecuados de protección conforme a la Ley 1581 de 2012 y sus normas reglamentarias. También podremos entregar información a autoridades cuando una norma o una orden judicial o administrativa lo exija.
`,
      ),
      block(
        "privacy-5",
        "5. Tus derechos como titular (habeas data)",
        `
De acuerdo con el artículo 8 de la Ley 1581 de 2012, tienes derecho a:

- Conocer, actualizar y rectificar tus datos personales.
- Solicitar prueba de la autorización que nos diste.
- Ser informado, previa solicitud, del uso que se ha dado a tus datos.
- Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la ley.
- Revocar la autorización y/o solicitar la supresión de tus datos cuando no se respeten los principios, derechos y garantías legales, o cuando ya no sean necesarios para las finalidades descritas, salvo deber legal o contractual de conservarlos.
- Acceder de forma gratuita a tus datos personales que hayan sido objeto de tratamiento.

Estos derechos corresponden a los llamados derechos de acceso, rectificación, cancelación y oposición. Puedes ejercerlos tú o tu representante, apoderado o causahabiente, acreditando su calidad.
`,
      ),
      block(
        "privacy-6",
        "6. Cómo ejercer tus derechos",
        `
Para consultas, reclamos, actualización, rectificación o supresión de datos, escríbenos a **${b.correo}** indicando en el asunto "Protección de datos personales". Incluye tu nombre completo, número de documento, medio de contacto y la descripción clara de tu solicitud (y los documentos que quieras hacer valer). ${"[COMPLETAR: dirección física alternativa para radicar solicitudes, si aplica]"}

Los plazos legales son:

- **Consultas:** las respondemos en máximo diez (10) días hábiles desde su recibo; si no es posible, te avisaremos el motivo y la nueva fecha, que no superará cinco (5) días hábiles adicionales.
- **Reclamos:** los atendemos en máximo quince (15) días hábiles desde su recibo (prorrogables por ocho (8) días hábiles más, informándote los motivos). Si el reclamo está incompleto, te pediremos subsanarlo dentro de los cinco (5) días siguientes.

Solo podrás acudir a la SIC una vez agotado este trámite de consulta o reclamo ante nosotros.
`,
      ),
      block(
        "privacy-7",
        "7. Cookies, seguridad, menores y vigencia",
        `
### Cookies

Usamos cookies y tecnologías similares para que el sitio funcione (mantener el carrito y la sesión), recordar preferencias y medir el uso del sitio. Puedes bloquearlas o eliminarlas desde la configuración de tu navegador, aunque algunas funciones, como el carrito o el inicio de sesión, podrían dejar de funcionar. ${"[COMPLETAR: detallar las cookies y herramientas de analítica o publicidad realmente usadas]"}

### Seguridad

Aplicamos medidas técnicas, humanas y administrativas razonables para proteger tus datos contra pérdida, acceso o uso no autorizado: conexiones cifradas, contraseñas almacenadas con cifrado, acceso restringido a la información y registros de auditoría. Ningún sistema es infalible; si detectamos un incidente que afecte tus datos, actuaremos conforme a la ley.

### Menores de edad

El sitio y sus compras están dirigidos a mayores de 18 años. No recolectamos conscientemente datos de niños, niñas y adolescentes (artículo 7 de la Ley 1581 de 2012). Si eres padre, madre o representante y crees que un menor nos entregó datos, escríbenos y los suprimiremos.

### Vigencia y cambios

Conservamos los datos mientras exista la relación contigo y durante el tiempo necesario para cumplir obligaciones legales, contables y tributarias, y luego los suprimimos o anonimizamos. Podemos actualizar esta política; la versión vigente es la publicada en esta página, con la fecha de actualización indicada arriba. Si el cambio es sustancial, te lo informaremos por los canales disponibles.
`,
      ),
    ],
  };
}

/* ─────────────────────────────── Envíos y devoluciones ─────────────────────────────── */

function shipping(b: Business, zones: ShippingZoneInfo[]): LegalPage {
  const zoneLines = zones
    .map((z) => {
      const where = z.departments.length > 10 ? "los demás departamentos del país" : z.departments.join(", ");
      const rates = z.rates
        .map((r) => {
          const free = r.freeOverSubtotal !== null ? `, gratis desde ${cop(r.freeOverSubtotal)}` : "";
          return `${r.name} ${cop(r.price)} (${days(r.minDays, r.maxDays)}${free})`;
        })
        .join("; ");
      return `- **${z.name}** (${where}): ${rates}.`;
    })
    .join("\n");

  return {
    handle: "envios-y-devoluciones",
    title: "Envíos y devoluciones",
    seoTitle: "Envíos y devoluciones",
    seoDescription: "Plazos y tarifas de envío en Colombia, derecho de retracto (5 días hábiles), condiciones de devolución y reembolsos en Daregular Dept.",
    footerLabel: "Envíos y devoluciones",
    sections: [
      header("shipping-header", "Envíos y devoluciones", DRAFT_NOTICE(b)),
      block(
        "shipping-1",
        "1. Cobertura, plazos y tarifas de envío",
        `
Enviamos a todo el territorio colombiano a través de ${"[COMPLETAR: transportadora(s) con la(s) que despachas]"}. El costo y el plazo se calculan según el departamento de entrega y se muestran en el checkout antes de pagar. Tarifas vigentes de referencia:

${zoneLines}

Los plazos son estimados, se cuentan en **días hábiles** (lunes a viernes, sin festivos) desde que el pedido sale de nuestra bodega y no incluyen el tiempo de alistamiento (${"[COMPLETAR: tiempo de alistamiento, p. ej. 1 a 2 días hábiles]"}). Pueden extenderse por temporadas altas, condiciones climáticas, orden público o zonas de difícil acceso. El valor definitivo que aplica a tu pedido es el que ves en el checkout.

Cuando tu pedido sale de la bodega te enviamos por correo la información de seguimiento (${"[COMPLETAR: guía/número de rastreo y enlace de la transportadora]"}).
`,
      ),
      block(
        "shipping-2",
        "2. Recepción del pedido",
        `
- Verifica que la dirección y el teléfono estén correctos al hacer el pedido: la transportadora intentará la entrega en ellos.
- Si nadie recibe el paquete, la transportadora hará ${"[COMPLETAR: número de intentos de entrega]"} intentos. Después podría devolverlo a nuestra bodega; en ese caso te contactaremos para reenviarlo (el nuevo envío puede tener costo) o reembolsarte el valor del producto, descontando el costo del envío.
- Revisa el empaque al recibir. Si llega abierto, roto o con señales de manipulación, déjalo anotado ante la transportadora y escríbenos a ${b.correo} dentro de las 48 horas siguientes con fotos del paquete y del producto.
- No hacemos entregas en el extranjero por el momento ${"[COMPLETAR: ajustar si haces envíos internacionales]"}.
`,
      ),
      block(
        "shipping-3",
        "3. Derecho de retracto (compras a distancia)",
        `
Conforme al artículo 47 de la Ley 1480 de 2011 (Estatuto del Consumidor), en las ventas a distancia (como las realizadas en este sitio) puedes **retractarte de la compra** y devolver el producto dentro de los **cinco (5) días hábiles** siguientes a la fecha en que lo recibiste, sin tener que dar explicaciones.

Condiciones para ejercerlo:

- Escríbenos a ${b.correo} dentro del plazo, indicando tu número de pedido, nombre y que deseas ejercer el derecho de retracto.
- El producto debe devolverse **en las mismas condiciones en que lo recibiste**: sin uso, sin lavar, sin alteraciones, con sus etiquetas, empaque y accesorios originales.
- Los costos de transporte de la devolución corren por cuenta del consumidor, salvo que el producto haya llegado con defectos o por error nuestro. ${"[COMPLETAR: confirmar política de costo de devolución]"}
- No aplica a los productos que por su naturaleza no pueden devolverse o puedan deteriorarse rápidamente, a los confeccionados o personalizados según tus especificaciones, ni a los demás casos exceptuados por la ley.

Cuando se ejerce el retracto, el contrato se resuelve y debemos reembolsarte **todas las sumas pagadas, sin retenciones ni descuentos** por el producto.
`,
      ),
      block(
        "shipping-4",
        "4. Cómo devolver un producto",
        `
- **Paso 1.** Escríbenos a ${b.correo} con tu número de pedido, el producto y el motivo (retracto, cambio de talla o garantía). Te responderemos con las instrucciones y la dirección de devolución (${b.direccion}, ${b.ciudad}).
- **Paso 2.** Empaca el producto con sus etiquetas y envíalo por una transportadora que permita rastreo; conserva la guía hasta que confirmemos la recepción.
- **Paso 3.** Cuando recibamos el producto lo revisamos (${"[COMPLETAR: plazo de revisión, p. ej. 3 días hábiles]"}). Si cumple las condiciones, procedemos con el reembolso, el cambio o la gestión de garantía.

No recibimos devoluciones sin autorización previa ni productos enviados a cobrar.
`,
      ),
      block(
        "shipping-5",
        "5. Reembolsos",
        `
Los reembolsos se hacen **por el mismo medio de pago** usado en la compra, por el valor pagado por el producto (y por el envío inicial cuando la devolución se debe a un error nuestro o a un producto defectuoso).

Una vez aprobada la devolución, reversamos el pago en el menor tiempo posible y, en todo caso, en un plazo máximo de **treinta (30) días calendario** desde que ejerciste el derecho de retracto, conforme a la ley. El tiempo en que el dinero se refleja en tu cuenta depende de tu banco o de la entidad financiera ${"[COMPLETAR: tiempos habituales por medio de pago]"}.

Si compraste con un código de descuento o promoción, se reembolsa el valor efectivamente pagado.
`,
      ),
    ],
  };
}

/* ─────────────────────────────── Cambios y garantías ─────────────────────────────── */

function exchanges(b: Business): LegalPage {
  return {
    handle: "cambios-y-garantias",
    title: "Cambios y garantías",
    seoTitle: "Cambios y garantías",
    seoDescription: "Cambios por talla y garantía legal de los productos de Daregular Dept.: condiciones, plazos y cómo solicitarlos (Ley 1480 de 2011).",
    footerLabel: "Cambios y garantías",
    sections: [
      header("exchanges-header", "Cambios y garantías", DRAFT_NOTICE(b)),
      block(
        "exchanges-1",
        "1. Cambios por talla",
        `
Si la talla no es la que esperabas, puedes pedir un **cambio por otra talla** del mismo producto, sujeto a disponibilidad. Esta es una política comercial propia de la tienda, adicional a los derechos que te otorga la ley.

- **Plazo:** hasta ${"[COMPLETAR: plazo para solicitar cambios, p. ej. 15 días calendario]"} después de recibir el pedido.
- **Estado del producto:** sin uso, sin lavar, sin alteraciones y con etiquetas y empaque originales.
- **Solicitud:** escríbenos a ${b.correo} con tu número de pedido, el producto y la talla que necesitas. Te confirmaremos la disponibilidad y cómo enviarlo.
- **Costos:** el primer envío de ida es ${"[COMPLETAR: quién asume el costo del cambio de talla, y si el reenvío es gratis]"}.
- Si la talla pedida no está disponible, podrás elegir otro producto del mismo valor o solicitar el reembolso, conforme a la política de [envíos y devoluciones](/pages/envios-y-devoluciones).

Los productos en promoción final, personalizados o de uso íntimo ${"[COMPLETAR: confirmar si hay productos sin cambio]"} pueden no tener cambio, lo cual se informará en la ficha del producto.
`,
      ),
      block(
        "exchanges-2",
        "2. Garantía legal",
        `
Todos los productos que vendemos cuentan con la **garantía legal** prevista en la Ley 1480 de 2011 (Estatuto del Consumidor): la obligación del productor y del proveedor de responder por la calidad, idoneidad y seguridad del producto y por que corresponda a lo ofrecido.

- **Término:** el establecido por la ley o la autoridad competente; a falta de este, el anunciado por el productor o proveedor; y, en ausencia de ambos, **un (1) año** para productos nuevos, contado desde la entrega. ${"[COMPLETAR: término de garantía que ofrece la tienda para cada tipo de producto]"}
- **Qué cubre:** defectos de fabricación o de confección, costuras o materiales que no correspondan a la calidad ofrecida, y estampados o acabados defectuosos en condiciones normales de uso.
- **Qué NO cubre:** desgaste normal por uso, daños por mal uso, lavado inadecuado (siga las instrucciones de la etiqueta), accidentes, alteraciones o arreglos hechos por terceros, y diferencias de color o textura que no afecten la calidad.

Ante un producto defectuoso puedes elegir, según la ley, entre la **reparación**, el **cambio por otro igual o equivalente** o, si no es posible o persiste el defecto, la **devolución del dinero**. Los costos de transporte asociados al trámite de una garantía legal procedente corren por cuenta de la tienda.
`,
      ),
      block(
        "exchanges-3",
        "3. Cómo solicitar una garantía o un cambio",
        `
- **Paso 1.** Escríbenos a ${b.correo} (o al ${b.telefono}) con tu número de pedido, una descripción del problema y **fotos o video** del defecto.
- **Paso 2.** Evaluaremos tu caso y te responderemos en ${"[COMPLETAR: plazo de respuesta, p. ej. 3 días hábiles]"}. Si es necesario, te pediremos enviar el producto para su revisión.
- **Paso 3.** Si la garantía procede, resolveremos con reparación, cambio o reembolso en un plazo máximo de **treinta (30) días calendario** desde que recibamos el producto, salvo que la ley fije uno distinto.
- Si la garantía no procede, te explicaremos por escrito los motivos.

Estas políticas no limitan tu derecho de retracto (ver [envíos y devoluciones](/pages/envios-y-devoluciones)) ni tu derecho a presentar peticiones, quejas o reclamos ante la Superintendencia de Industria y Comercio (SIC).

Para cualquier duda: ${b.correo}.
`,
      ),
    ],
  };
}

export function buildLegalPages(business: Business, zones: ShippingZoneInfo[]): LegalPage[] {
  return [terms(business), privacy(business), shipping(business, zones), exchanges(business)];
}

/** Marcadores `[COMPLETAR: ...]` que quedan en una página (en cualquier texto de sus secciones). */
export function findPlaceholders(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\[COMPLETAR:[^\]]*\]/g)) found.push(m[0]);
  } else if (Array.isArray(value)) {
    for (const v of value) findPlaceholders(v, found);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) findPlaceholders(v, found);
  }
  return found;
}
