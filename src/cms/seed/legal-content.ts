import type { SeedDocument } from "./default-content";

/**
 * Páginas legales por defecto (tienda online en Colombia, precios en COP con IVA incluido).
 * Los datos de la empresa (LEGAL_ENTITY) son PROVISIONALES: reemplázalos desde el panel (Contenido → Páginas)
 * cuando tengas los definitivos. Las solicitudes también se canalizan por el formulario de /pages/contact.
 */

export const LEGAL_UPDATED = "22 de octubre de 2026";
export const LEGAL_ENTITY = {
  name: "Daregular Dept. S.A.S.",
  nit: "000.000.000-0",
  address: "Bogotá D.C., Colombia",
  email: "contacto@daregulardept.com",
  phone: "+57 300 000 0000",
} as const;
const ENTITY_LINES = `- **Razón social:** ${LEGAL_ENTITY.name}
- **NIT:** ${LEGAL_ENTITY.nit}
- **Domicilio:** ${LEGAL_ENTITY.address}
- **Correo:** ${LEGAL_ENTITY.email}
- **Teléfono:** ${LEGAL_ENTITY.phone}`;
const UPDATED_NOTE = `*Última actualización: ${LEGAL_UPDATED}.*`;

type Settings = Record<string, unknown>;
const section = (id: string, type: string, settings: Settings) => ({ id, type, enabled: true, settings });

const header = (prefix: string, heading: string, lead: string) =>
  section(`${prefix}-header`, "page-header", { eyebrow: "Legal", heading, lead, alignment: "left" });

const richText = (id: string, heading: string, body: string) =>
  section(id, "rich-text", { heading, body, alignment: "left", maxWidth: "narrow" });

const lines = (...parts: string[]) => parts.join("\n\n");

// ── Términos y condiciones ───────────────────────────────────────────────────
const termsPage = {
  title: "Términos y condiciones",
  handle: "terminos-y-condiciones",
  template: "page",
  seoTitle: "Términos y condiciones",
  seoDescription: "Condiciones de uso del sitio y de compra en Daregular Dept.: precios en COP con IVA incluido, pagos, envíos, cambios y devoluciones.",
  sections: [
    header("terms", "Términos y\ncondiciones", "Las reglas claras para comprar en Daregular Dept."),
    richText(
      "terms-general",
      "Objeto y aceptación",
      lines(
        "Estos términos y condiciones regulan el acceso y uso de este sitio web y las compras de productos que se hacen a través de él. El sitio es operado por Daregular Dept. (en adelante, \"Daregular Dept.\", \"nosotros\" o \"la tienda\"), una tienda de ropa que vende en Colombia.",
        "## Quiénes somos",
        ENTITY_LINES,
        "Al navegar por el sitio, crear una cuenta o realizar un pedido, aceptas estos términos. Si no estás de acuerdo con ellos, te pedimos que no uses el sitio ni realices compras.",
        "## Uso del sitio",
        "Te comprometes a usar el sitio de buena fe y de forma lícita. En particular, no puedes:",
        "- Usar el sitio para fines fraudulentos o contrarios a la ley.\n- Intentar acceder sin autorización a cuentas, sistemas o datos de otras personas.\n- Interferir con el funcionamiento del sitio o con su seguridad.\n- Usar medios automatizados para extraer contenido o realizar compras masivas.",
        "Para comprar debes ser mayor de edad y tener capacidad legal para obligarte. Los menores de edad solo pueden usar el sitio con la supervisión de su representante legal.",
        "## Cuenta de usuario",
        "Puedes crear una cuenta para consultar tus pedidos, administrar tus direcciones y agilizar tus compras. Eres responsable de la veracidad de los datos que registras, de mantener la confidencialidad de tu contraseña y de la actividad realizada desde tu cuenta. Si sospechas de un uso no autorizado, cambia tu contraseña y escríbenos desde la página de contacto.",
        "Puedes exportar tus datos y eliminar tu cuenta cuando quieras desde la sección de tu cuenta. Más información en nuestra [Política de privacidad](/pages/politica-de-privacidad).",
      ),
    ),
    richText(
      "terms-purchase",
      "Productos, precios y compra",
      lines(
        "## Productos y precios",
        "Todos los precios se muestran en pesos colombianos (COP) e incluyen el IVA. El costo de envío no está incluido en el precio del producto: se calcula según el destino y se muestra antes de pagar, en el proceso de compra.",
        "Hacemos todo lo posible para que las fotografías, descripciones y precios sean exactos. Los colores pueden verse distintos según la pantalla de tu dispositivo. Si detectamos un error evidente de precio o de información en un pedido, te contactaremos para corregirlo o, si prefieres, cancelar el pedido y devolverte lo pagado.",
        "## Disponibilidad y reserva de stock",
        "Los productos están sujetos a disponibilidad. Cuando inicias el pago de un pedido, reservamos las unidades por un tiempo limitado mientras se completa el pago. Si el pago no se confirma dentro de ese tiempo, el pedido se cancela y las unidades vuelven a estar disponibles para otros clientes. Tener un producto en el carrito no garantiza su disponibilidad.",
        "## Proceso de compra y confirmación del pedido",
        "1. Elige el producto y la talla, y añádelos al carrito.\n2. Inicia la compra e ingresa tus datos de contacto y la dirección de entrega.\n3. Revisa el resumen: productos, envío y total a pagar en COP.\n4. Paga a través de la pasarela de pagos.\n5. Cuando el pago se confirma, tu pedido queda registrado y recibes la confirmación por correo electrónico.",
        "El contrato de compraventa se perfecciona cuando se confirma el pago de tu pedido. Hasta ese momento, el pedido no está en firme. Nos reservamos el derecho de cancelar pedidos en casos de error evidente, falta de disponibilidad o sospecha razonable de fraude, y en ese caso reembolsaremos lo pagado.",
      ),
    ),
    richText(
      "terms-payments",
      "Pagos, envíos y devoluciones",
      lines(
        "## Medios de pago",
        "Los pagos se procesan a través de una pasarela de pagos externa y segura. Los medios de pago disponibles son los que aparecen habilitados en el momento del pago. No almacenamos los datos completos de tu tarjeta ni de tu cuenta bancaria: esa información la gestiona la pasarela.",
        "## Envíos",
        "Enviamos a todo el territorio colombiano. Las tarifas, los tiempos de entrega y las condiciones de la entrega se describen en la página de [Envíos](/pages/envios).",
        "## Cambios y devoluciones",
        "Puedes ejercer el derecho de retracto, solicitar cambios de talla y hacer valer la garantía legal según se explica en la página de [Cambios y devoluciones](/pages/cambios-y-devoluciones).",
        "## Propiedad intelectual",
        "El nombre Daregular Dept., el logotipo, las fotografías, los textos, los diseños, los gráficos y demás contenidos del sitio son de nuestra propiedad o se usan con autorización de sus titulares, y están protegidos por las normas de propiedad intelectual. No puedes copiarlos, reproducirlos, modificarlos ni usarlos con fines comerciales sin nuestra autorización previa y por escrito.",
      ),
    ),
    richText(
      "terms-legal",
      "Responsabilidad, cambios y ley aplicable",
      lines(
        "## Responsabilidad",
        "Procuramos que el sitio funcione de manera continua y sin errores, pero no garantizamos que esté libre de interrupciones. No somos responsables por fallas ajenas a nuestro control, como caídas de internet, fallas de proveedores externos o fuerza mayor. Nada en estos términos limita los derechos que la ley reconoce a los consumidores ni nuestra responsabilidad por los productos que vendemos.",
        "El sitio puede contener enlaces a páginas de terceros. No controlamos su contenido y no somos responsables de él.",
        "## Modificaciones",
        "Podemos actualizar estos términos para reflejar cambios en el sitio, en nuestros procesos o en la ley. La versión vigente es la publicada en esta página, con su fecha de última actualización. Los pedidos que hayas realizado antes de un cambio se rigen por los términos vigentes al momento de la compra.",
        "## Ley aplicable y jurisdicción",
        "Estos términos se rigen por las leyes de la República de Colombia, en particular el Estatuto del Consumidor (Ley 1480 de 2011). Cualquier controversia se someterá a las autoridades competentes de Colombia. Como consumidor, también puedes acudir a la Superintendencia de Industria y Comercio (SIC).",
        "## Contacto",
        "Si tienes preguntas sobre estos términos, escríbenos desde la [página de contacto](/pages/contact).",
        UPDATED_NOTE,
      ),
    ),
  ],
};

// ── Política de privacidad ───────────────────────────────────────────────────
const privacyPage = {
  title: "Política de privacidad",
  handle: "politica-de-privacidad",
  template: "page",
  seoTitle: "Política de privacidad y tratamiento de datos personales",
  seoDescription: "Cómo Daregular Dept. trata tus datos personales conforme a la Ley 1581 de 2012: finalidades, derechos, consultas, reclamos y conservación.",
  sections: [
    header("privacy", "Política de\nprivacidad", "Cómo tratamos tus datos personales y cuáles son tus derechos."),
    richText(
      "privacy-intro",
      "Responsable y datos que recolectamos",
      lines(
        "Esta política describe cómo Daregular Dept. trata los datos personales de quienes visitan el sitio, crean una cuenta, compran o se suscriben a nuestro boletín, conforme a la Ley 1581 de 2012 y sus decretos reglamentarios sobre protección de datos personales en Colombia.",
        "## Responsable del tratamiento",
        "El responsable del tratamiento de tus datos personales es Daregular Dept.",
        ENTITY_LINES,
        "Para cualquier solicitud relacionada con tus datos puedes escribirnos a esos datos de contacto o a través del formulario de la [página de contacto](/pages/contact).",
        "## Datos que recolectamos",
        "- **Cuenta:** nombre, correo electrónico, teléfono (si lo registras) y contraseña, que se almacena de forma protegida.\n- **Pedidos:** productos comprados, valores, estado del pedido y del pago, y datos de facturación y entrega.\n- **Direcciones:** direcciones de envío que registras o ingresas al comprar.\n- **Contacto:** los datos y el mensaje que nos envías por el formulario de contacto.\n- **Newsletter:** tu correo electrónico, si te suscribes.\n- **Datos técnicos y cookies:** información básica del dispositivo y de la navegación, y cookies necesarias para el funcionamiento del sitio, como mantener tu sesión y tu carrito.",
        "No recolectamos datos sensibles. Los datos de tu tarjeta o cuenta bancaria los procesa directamente la pasarela de pagos y no quedan almacenados en nuestro sitio.",
      ),
    ),
    richText(
      "privacy-use",
      "Finalidades y autorización",
      lines(
        "## Finalidades del tratamiento",
        "Usamos tus datos para:",
        "- Crear y administrar tu cuenta.\n- Procesar, confirmar, enviar y hacer seguimiento a tus pedidos, y gestionar pagos, cambios, devoluciones y reembolsos.\n- Atender tus consultas, peticiones, quejas y reclamos.\n- Enviarte comunicaciones sobre tus pedidos y sobre el servicio.\n- Enviarte novedades y ofertas por correo, solo si te suscribiste al newsletter.\n- Mantener la seguridad del sitio y prevenir el fraude.\n- Cumplir obligaciones legales, contables y tributarias.",
        "## Autorización y consentimiento",
        "Tratamos tus datos con tu autorización previa, expresa e informada, que otorgas al crear tu cuenta, al realizar una compra, al escribirnos o al suscribirte, según el caso. También podemos tratarlos cuando la ley lo permita o lo exija.",
        "La suscripción al newsletter es voluntaria y usa doble confirmación: después de dejar tu correo te enviamos un mensaje para que confirmes que quieres suscribirte, y solo entonces recibirás nuestras comunicaciones. Puedes darte de baja en cualquier momento.",
      ),
    ),
    richText(
      "privacy-rights",
      "Tus derechos y cómo ejercerlos",
      lines(
        "## Derechos del titular",
        "Como titular de los datos tienes derecho a:",
        "- Conocer, actualizar y rectificar tus datos personales.\n- Solicitar prueba de la autorización que nos diste.\n- Ser informado sobre el uso que se ha dado a tus datos.\n- Acceder de forma gratuita a tus datos personales.\n- Revocar la autorización y solicitar la supresión de tus datos cuando no se respeten los principios y garantías legales o cuando no exista un deber legal o contractual de conservarlos.\n- Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por infracciones a la normativa de protección de datos.",
        "## Exportar y eliminar tus datos desde tu cuenta",
        "Si tienes una cuenta, puedes usar las opciones \"exportar mis datos\" y \"eliminar mi cuenta\" disponibles en la sección de tu cuenta. Al eliminar tu cuenta, suprimimos o anonimizamos tus datos personales, salvo aquellos que debamos conservar por obligación legal, como la información de pedidos y facturación.",
        "## Consultas y reclamos",
        "Para presentar una consulta o un reclamo, usa el formulario de la [página de contacto](/pages/contact) e indica tu nombre, el correo asociado a tu cuenta o pedido y qué solicitas. Podemos pedirte información adicional para verificar tu identidad.",
        "- **Consultas:** las atendemos en un máximo de 10 días hábiles contados desde su recepción. Si no es posible, te informaremos el motivo y la nueva fecha de respuesta, que no podrá superar 5 días hábiles adicionales.\n- **Reclamos** (para corregir, actualizar o suprimir datos, o por presunto incumplimiento): los atendemos en un máximo de 15 días hábiles contados desde su recepción. Si no es posible, te informaremos el motivo y la nueva fecha de respuesta, que no podrá superar 8 días hábiles adicionales.",
        "Solo puedes acudir a la SIC después de haber agotado este trámite de consulta o reclamo ante nosotros.",
      ),
    ),
    richText(
      "privacy-security",
      "Seguridad, terceros y conservación",
      lines(
        "## Seguridad",
        "Aplicamos medidas técnicas y organizativas razonables para proteger tus datos contra acceso no autorizado, pérdida o alteración, como conexiones cifradas y almacenamiento protegido de contraseñas. Ningún sistema es completamente infalible, por lo que también te pedimos cuidar tus credenciales.",
        "## Menores de edad",
        "El sitio no está dirigido a menores de edad y no recolectamos de forma intencional datos de menores. Si eres representante legal y crees que un menor nos entregó datos, escríbenos para eliminarlos.",
        "## Encargados y terceros",
        "Para operar la tienda compartimos los datos estrictamente necesarios con proveedores que actúan como encargados del tratamiento o como terceros, entre ellos:",
        "- La **pasarela de pagos**, para procesar tu pago.\n- Las **transportadoras**, para entregar tu pedido.\n- **Proveedores tecnológicos** de alojamiento, correo electrónico y operación del sitio.",
        "Estos proveedores solo pueden usar los datos para prestarnos el servicio y deben proteger su confidencialidad. No vendemos tus datos personales. También podemos entregarlos a autoridades cuando una norma o una orden legítima lo exija.",
        "## Transferencias y transmisiones",
        "Algunos proveedores tecnológicos pueden almacenar o procesar datos en servidores ubicados fuera de Colombia. En esos casos buscamos que el proveedor ofrezca niveles adecuados de protección y cumpla la normativa aplicable.",
        "## Conservación",
        "Conservamos tus datos mientras mantengas tu cuenta o sea necesario para las finalidades descritas, y después durante el tiempo que exijan las normas legales, contables y tributarias o que sea necesario para atender reclamaciones. Cumplido ese plazo, los eliminamos o anonimizamos.",
        "## Vigencia y cambios",
        "Esta política rige desde la fecha de su última actualización. Si la modificamos, publicaremos la nueva versión en esta página.",
        UPDATED_NOTE,
      ),
    ),
  ],
};

// ── Cambios y devoluciones ───────────────────────────────────────────────────
const returnsPage = {
  title: "Cambios y devoluciones",
  handle: "cambios-y-devoluciones",
  template: "page",
  seoTitle: "Cambios y devoluciones",
  seoDescription: "Derecho de retracto de 5 días hábiles, cambios de talla, garantía legal y reembolsos en tus compras en Daregular Dept.",
  sections: [
    header("returns", "Cambios y\ndevoluciones", "Si algo no es lo que esperabas, te explicamos qué puedes hacer."),
    richText(
      "returns-withdrawal",
      "Derecho de retracto y condiciones",
      lines(
        "## Derecho de retracto",
        "Como las compras en este sitio son ventas a distancia, el Estatuto del Consumidor (Ley 1480 de 2011) te permite retractarte de la compra y devolver el producto. Puedes hacerlo dentro de los 5 días hábiles siguientes a la entrega del producto, sin necesidad de explicar tus motivos.",
        "## Condiciones del producto",
        "Para aceptar la devolución, el producto debe:",
        "- Estar sin usar, sin lavar y sin modificaciones.\n- Conservar las etiquetas y su empaque original.\n- Estar en las mismas condiciones en que lo recibiste.",
        "## Cambios por talla",
        "Si la talla no te quedó bien, puedes solicitar un cambio por otra talla del mismo producto. El cambio está sujeto a que la talla solicitada esté disponible. Si no lo está, puedes elegir otro producto o ejercer el retracto y recibir el reembolso.",
        "## Garantía legal",
        "Si el producto llegó con un defecto de fabricación, o no corresponde a lo que compraste, tienes derecho a la garantía legal, que es independiente del retracto y se puede ejercer aunque haya pasado el plazo de 5 días hábiles. Escríbenos describiendo el defecto; si hace falta, te pediremos fotografías. Según el caso, repararemos, cambiaremos el producto o te devolveremos el dinero conforme a la ley.",
        "## Productos excluidos",
        "La ley excluye del derecho de retracto, entre otros, los productos confeccionados conforme a las especificaciones del consumidor o claramente personalizados. Si alguno de nuestros productos tiene esta condición, se indicará en su ficha antes de la compra. La garantía legal por defectos aplica siempre.",
      ),
    ),
    richText(
      "returns-process",
      "Cómo solicitarlo y reembolsos",
      lines(
        "## Proceso paso a paso",
        "1. Escríbenos desde la [página de contacto](/pages/contact) dentro del plazo, indicando el número de tu pedido, el producto, y si quieres un cambio, una devolución o hacer uso de la garantía.\n2. Te responderemos con las instrucciones para enviar el producto y, si hace falta, te pediremos fotografías.\n3. Empaca el producto con sus etiquetas y envíalo según las instrucciones.\n4. Cuando recibamos el producto y verifiquemos su estado, procesamos el cambio o el reembolso y te avisamos por correo electrónico.",
        "## Costos de envío de la devolución",
        "En el ejercicio del derecho de retracto y en los cambios por talla, el costo del envío de regreso del producto corre por tu cuenta. Si el producto llegó defectuoso, equivocado o dañado, nosotros asumimos los costos de envío del cambio o de la devolución.",
        "## Reembolsos",
        "El reembolso se hace por el mismo medio de pago que usaste en la compra. Cuando el retracto es procedente, devolvemos el dinero dentro de los 30 días calendario siguientes a que nos comuniques el retracto. El tiempo que tarde en reflejarse en tu cuenta o tarjeta depende de tu entidad financiera.",
        "## Reversión del pago",
        "Si pagaste con tarjeta de crédito, débito u otro instrumento de pago electrónico y fuiste víctima de fraude, la operación fue no solicitada, no recibiste el producto, o este llegó distinto a lo pedido o defectuoso, puedes solicitar la reversión del pago conforme al Estatuto del Consumidor y al Decreto 587 de 2016. Debes presentar la queja ante el emisor de tu medio de pago y notificarnos dentro de los 5 días hábiles siguientes a la fecha en que tuviste noticia de la operación o de la recepción del producto. Si tienes dudas, escríbenos y te ayudamos a revisar tu caso.",
        "## Tiempos de respuesta",
        "Respondemos las solicitudes de cambio, devolución o garantía lo antes posible y, en todo caso, dentro de los plazos que fija la ley.",
        UPDATED_NOTE,
      ),
    ),
  ],
};

// ── Envíos ───────────────────────────────────────────────────────────────────
const shippingPage = {
  title: "Envíos",
  handle: "envios",
  template: "page",
  seoTitle: "Envíos",
  seoDescription: "Cobertura nacional en Colombia, tarifas y tiempos por destino, envío gratis, seguimiento con número de guía y entregas en Daregular Dept.",
  sections: [
    header("shipping", "Envíos", "Cómo llega tu pedido, a dónde y cuándo."),
    richText(
      "shipping-info",
      "Cobertura, tarifas y tiempos",
      lines(
        "## Cobertura",
        "Hacemos envíos a todo el territorio nacional de Colombia. Por ahora no realizamos envíos internacionales.",
        "## Tarifas y tiempos de entrega",
        "El costo de envío y el tiempo estimado de entrega dependen del destino y se muestran en el proceso de compra, antes de pagar, una vez ingresas tu dirección. El valor que ves en el resumen del pedido es el que pagas por el envío. Los tiempos son estimados y pueden variar por factores de la transportadora, festivos, clima u orden público.",
        "## Envío gratis",
        "Cuando tu pedido alcanza el monto mínimo para envío gratis, el checkout lo muestra y no se cobra el envío. Ese monto, si está vigente, aparece en el proceso de compra.",
        "## Preparación del pedido",
        "Preparamos tu pedido una vez se confirma el pago. El tiempo de entrega estimado que ves al comprar corresponde al trayecto con la transportadora; la preparación y el despacho del pedido se hacen antes de ese trayecto.",
        "## Seguimiento",
        "Cuando tu pedido es despachado te avisamos por correo electrónico e incluimos el número de guía para que puedas hacer seguimiento en el sitio de la transportadora.",
      ),
    ),
    richText(
      "shipping-delivery",
      "Entrega, ausencias y daños",
      lines(
        "## Direcciones de entrega",
        "Revisa con cuidado que tu dirección, ciudad, datos de contacto y teléfono estén completos y correctos. Si la dirección es incorrecta o incompleta, la entrega puede retrasarse o fallar, y podrían generarse costos adicionales de reenvío.",
        "## Ausencia en la entrega",
        "Si nadie recibe el pedido, la transportadora normalmente intentará entregarlo de nuevo o te contactará para coordinar la entrega. Si después de los intentos no es posible entregarlo, el pedido puede regresar a nuestras instalaciones. En ese caso, escríbenos desde la [página de contacto](/pages/contact) para acordar una solución.",
        "## Recepción y daños en transporte",
        "Al recibir tu pedido, revisa que el empaque esté en buen estado. Si notas daños evidentes, déjalo indicado en la guía o el comprobante de entrega si es posible, y avísanos lo antes posible por la [página de contacto](/pages/contact); te indicaremos cómo enviarnos fotografías del empaque y del producto. Revisaremos tu caso para reponer o reparar el producto afectado.",
        "## Envíos internacionales",
        "No están disponibles. Solo despachamos a direcciones dentro de Colombia.",
        "## Cambios y devoluciones",
        "Si necesitas cambiar o devolver un pedido, consulta la página de [Cambios y devoluciones](/pages/cambios-y-devoluciones).",
        UPDATED_NOTE,
      ),
    ),
  ],
};

export const LEGAL_DOCUMENTS: SeedDocument[] = [
  { kind: "page", key: "terminos-y-condiciones", title: termsPage.title, data: termsPage },
  { kind: "page", key: "politica-de-privacidad", title: privacyPage.title, data: privacyPage },
  { kind: "page", key: "cambios-y-devoluciones", title: returnsPage.title, data: returnsPage },
  { kind: "page", key: "envios", title: shippingPage.title, data: shippingPage },
];

/** Columna "Legal" del pie de página (también la usa `ensureLegalLinks` para bases existentes). */
export const LEGAL_FOOTER_COLUMN = {
  id: "col-legal",
  type: "column",
  settings: {
    title: "Legal",
    links: [
      { label: "Términos y condiciones", url: "/pages/terminos-y-condiciones" },
      { label: "Política de privacidad", url: "/pages/politica-de-privacidad" },
      { label: "Cambios y devoluciones", url: "/pages/cambios-y-devoluciones" },
      { label: "Envíos", url: "/pages/envios" },
    ],
  },
};
