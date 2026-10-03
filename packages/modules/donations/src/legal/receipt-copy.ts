/**
 * LEGAL-COPY — for counsel's review (label `legal-copy`, plan `docs/plans/phase-4.md` P4-11).
 *
 * Every word a donation receipt, a year-end giving statement and the quid-pro-quo notice on a
 * ticket page says lives in this one file, so counsel can review it in one place. The receipt is
 * the charity's statement, not Yayatoh's. Rules from the plan:
 * - charity name and EIN (or the fiscal sponsor's), donor, date and amount on every receipt;
 * - "No goods or services were provided in exchange for this contribution" for a pure gift;
 * - otherwise a description and good-faith fair-market value of what was received, with the
 *   deductible amount = amount paid − fair-market value;
 * - "This payment is not tax-deductible" for an org without a verified charity profile;
 * - the quid-pro-quo notice on ticket pages for payments over $75 (IRC §6115).
 *
 * US and USD only at first. The English text is the source; the other 12 locales are courtesy
 * translations of it (pending counsel: docs/owner-inbox.md). Bump `RECEIPT_COPY_VERSION` on any
 * change: every receipt and statement stores the version it was issued with.
 *
 * Placeholders (ICU): {charity} {ein} {sponsor} {sponsorEin} {amount} {fmv} {deductible} {goods}
 * {year} {price}.
 */
import type { Locale } from '@yayatoh/contracts';

export const RECEIPT_COPY_VERSION = '2026-10-02.1';

export interface ReceiptCopy {
  readonly receiptTitle: string;
  readonly plainTitle: string;
  readonly statementTitle: string;
  readonly labels: {
    readonly number: string;
    readonly date: string;
    readonly donor: string;
    readonly charity: string;
    readonly ein: string;
    readonly address: string;
    readonly event: string;
    readonly amount: string;
    readonly fmv: string;
    readonly deductible: string;
    readonly goods: string;
    readonly year: string;
    readonly payments: string;
    readonly total: string;
  };
  /** The charity's own 501(c)(3) status. */
  readonly exempt: string;
  /** A fiscally sponsored project: the sponsor's status and EIN. */
  readonly sponsored: string;
  readonly noGoods: string;
  readonly quidProQuo: string;
  readonly notDeductible: string;
  readonly keep: string;
  readonly statementIntro: string;
  readonly statementTotal: string;
  /** The ticket page notice (payments over $75). */
  readonly noticeTitle: string;
  readonly notice: string;
  readonly footer: string;
}

const en: ReceiptCopy = {
  receiptTitle: 'Donation receipt',
  plainTitle: 'Payment receipt',
  statementTitle: '{year} giving statement',
  labels: {
    number: 'Receipt number',
    date: 'Date of payment',
    donor: 'Received from',
    charity: 'Organization',
    ein: 'EIN',
    address: 'Address',
    event: 'Event',
    amount: 'Amount paid',
    fmv: 'Fair-market value of goods or services',
    deductible: 'Tax-deductible amount',
    goods: 'Goods or services provided',
    year: 'Tax year',
    payments: 'Payments',
    total: 'Total',
  },
  exempt:
    '{charity} is exempt from federal income tax under Section 501(c)(3) of the Internal Revenue Code (EIN {ein}).',
  sponsored:
    '{charity} is a fiscally sponsored project of {sponsor}, which is exempt from federal income tax under Section 501(c)(3) of the Internal Revenue Code (EIN {sponsorEin}). Contributions are made to {sponsor} for the benefit of {charity}.',
  noGoods: 'No goods or services were provided in exchange for this contribution.',
  quidProQuo:
    'In exchange for this payment of {amount}, you received goods or services with an estimated fair-market value of {fmv}. The amount of your contribution that is deductible for federal income tax purposes is limited to {deductible}.',
  notDeductible: 'This payment is not tax-deductible.',
  keep: 'Please keep this receipt with your tax records.',
  statementIntro:
    'Thank you for your support. This statement lists your tax-deductible payments to {charity} from January 1 to December 31, {year}, as receipted at the time of each payment.',
  statementTotal: 'Total tax-deductible amount for {year}: {deductible}.',
  noticeTitle: 'Tax-deductible amount',
  notice:
    'Of your {price} payment, {deductible} is tax-deductible. The estimated fair-market value of the goods and services you receive is {fmv}.',
  footer: 'Issued by {charity}. Yayatoh processes payments and receipts on its behalf.',
};

const es: ReceiptCopy = {
  receiptTitle: 'Recibo de donación',
  plainTitle: 'Recibo de pago',
  statementTitle: 'Resumen de donaciones de {year}',
  labels: {
    number: 'Número de recibo',
    date: 'Fecha del pago',
    donor: 'Recibido de',
    charity: 'Organización',
    ein: 'EIN',
    address: 'Dirección',
    event: 'Evento',
    amount: 'Importe pagado',
    fmv: 'Valor justo de mercado de los bienes o servicios',
    deductible: 'Importe deducible de impuestos',
    goods: 'Bienes o servicios entregados',
    year: 'Año fiscal',
    payments: 'Pagos',
    total: 'Total',
  },
  exempt:
    '{charity} está exenta del impuesto federal sobre la renta según la Sección 501(c)(3) del Código de Rentas Internas (EIN {ein}).',
  sponsored:
    '{charity} es un proyecto con patrocinio fiscal de {sponsor}, que está exenta del impuesto federal sobre la renta según la Sección 501(c)(3) del Código de Rentas Internas (EIN {sponsorEin}). Las contribuciones se hacen a {sponsor} en beneficio de {charity}.',
  noGoods: 'No se entregaron bienes ni servicios a cambio de esta contribución.',
  quidProQuo:
    'A cambio de este pago de {amount}, recibió bienes o servicios con un valor justo de mercado estimado de {fmv}. La parte de su contribución deducible del impuesto federal sobre la renta se limita a {deductible}.',
  notDeductible: 'Este pago no es deducible de impuestos.',
  keep: 'Conserve este recibo con sus registros fiscales.',
  statementIntro:
    'Gracias por su apoyo. Este resumen enumera sus pagos deducibles de impuestos a {charity} del 1 de enero al 31 de diciembre de {year}, según los recibos emitidos en el momento de cada pago.',
  statementTotal: 'Importe total deducible de impuestos de {year}: {deductible}.',
  noticeTitle: 'Importe deducible de impuestos',
  notice:
    'De su pago de {price}, {deductible} es deducible de impuestos. El valor justo de mercado estimado de los bienes y servicios que recibe es {fmv}.',
  footer: 'Emitido por {charity}. Yayatoh procesa los pagos y recibos en su nombre.',
};

const fr: ReceiptCopy = {
  receiptTitle: 'Reçu de don',
  plainTitle: 'Reçu de paiement',
  statementTitle: 'Relevé des dons {year}',
  labels: {
    number: 'Numéro de reçu',
    date: 'Date du paiement',
    donor: 'Reçu de',
    charity: 'Organisation',
    ein: 'EIN',
    address: 'Adresse',
    event: 'Événement',
    amount: 'Montant payé',
    fmv: 'Juste valeur marchande des biens ou services',
    deductible: 'Montant déductible des impôts',
    goods: 'Biens ou services fournis',
    year: 'Année fiscale',
    payments: 'Paiements',
    total: 'Total',
  },
  exempt:
    '{charity} est exonérée de l’impôt fédéral sur le revenu en vertu de la section 501(c)(3) de l’Internal Revenue Code (EIN {ein}).',
  sponsored:
    '{charity} est un projet sous parrainage fiscal de {sponsor}, exonérée de l’impôt fédéral sur le revenu en vertu de la section 501(c)(3) de l’Internal Revenue Code (EIN {sponsorEin}). Les contributions sont versées à {sponsor} au profit de {charity}.',
  noGoods: 'Aucun bien ni service n’a été fourni en échange de cette contribution.',
  quidProQuo:
    'En échange de ce paiement de {amount}, vous avez reçu des biens ou services d’une juste valeur marchande estimée à {fmv}. La part de votre contribution déductible de l’impôt fédéral sur le revenu est limitée à {deductible}.',
  notDeductible: 'Ce paiement n’est pas déductible des impôts.',
  keep: 'Veuillez conserver ce reçu avec vos documents fiscaux.',
  statementIntro:
    'Merci de votre soutien. Ce relevé liste vos paiements déductibles des impôts à {charity} du 1er janvier au 31 décembre {year}, tels qu’ils ont été reçus au moment de chaque paiement.',
  statementTotal: 'Montant total déductible des impôts pour {year} : {deductible}.',
  noticeTitle: 'Montant déductible des impôts',
  notice:
    'Sur votre paiement de {price}, {deductible} est déductible des impôts. La juste valeur marchande estimée des biens et services que vous recevez est de {fmv}.',
  footer: 'Émis par {charity}. Yayatoh traite les paiements et les reçus pour son compte.',
};

const de: ReceiptCopy = {
  receiptTitle: 'Spendenquittung',
  plainTitle: 'Zahlungsbeleg',
  statementTitle: 'Spendenübersicht {year}',
  labels: {
    number: 'Belegnummer',
    date: 'Zahlungsdatum',
    donor: 'Erhalten von',
    charity: 'Organisation',
    ein: 'EIN',
    address: 'Adresse',
    event: 'Veranstaltung',
    amount: 'Gezahlter Betrag',
    fmv: 'Marktwert der Waren oder Leistungen',
    deductible: 'Steuerlich absetzbarer Betrag',
    goods: 'Erhaltene Waren oder Leistungen',
    year: 'Steuerjahr',
    payments: 'Zahlungen',
    total: 'Summe',
  },
  exempt:
    '{charity} ist nach Section 501(c)(3) des Internal Revenue Code von der US-Bundeseinkommensteuer befreit (EIN {ein}).',
  sponsored:
    '{charity} ist ein steuerlich getragenes Projekt von {sponsor}, das nach Section 501(c)(3) des Internal Revenue Code von der US-Bundeseinkommensteuer befreit ist (EIN {sponsorEin}). Zuwendungen gehen an {sponsor} zugunsten von {charity}.',
  noGoods: 'Für diese Zuwendung wurden keine Waren oder Leistungen erbracht.',
  quidProQuo:
    'Im Gegenzug für diese Zahlung von {amount} haben Sie Waren oder Leistungen mit einem geschätzten Marktwert von {fmv} erhalten. Der für die US-Bundeseinkommensteuer absetzbare Teil Ihrer Zuwendung ist auf {deductible} begrenzt.',
  notDeductible: 'Diese Zahlung ist steuerlich nicht absetzbar.',
  keep: 'Bitte bewahren Sie diesen Beleg bei Ihren Steuerunterlagen auf.',
  statementIntro:
    'Danke für Ihre Unterstützung. Diese Übersicht listet Ihre steuerlich absetzbaren Zahlungen an {charity} vom 1. Januar bis 31. Dezember {year}, wie sie bei jeder Zahlung quittiert wurden.',
  statementTotal: 'Steuerlich absetzbarer Gesamtbetrag {year}: {deductible}.',
  noticeTitle: 'Steuerlich absetzbarer Betrag',
  notice:
    'Von Ihrer Zahlung von {price} sind {deductible} steuerlich absetzbar. Der geschätzte Marktwert der Waren und Leistungen, die Sie erhalten, beträgt {fmv}.',
  footer: 'Ausgestellt von {charity}. Yayatoh wickelt Zahlungen und Belege in ihrem Auftrag ab.',
};

const it: ReceiptCopy = {
  receiptTitle: 'Ricevuta di donazione',
  plainTitle: 'Ricevuta di pagamento',
  statementTitle: 'Riepilogo donazioni {year}',
  labels: {
    number: 'Numero ricevuta',
    date: 'Data del pagamento',
    donor: 'Ricevuto da',
    charity: 'Organizzazione',
    ein: 'EIN',
    address: 'Indirizzo',
    event: 'Evento',
    amount: 'Importo pagato',
    fmv: 'Valore equo di mercato di beni o servizi',
    deductible: 'Importo deducibile',
    goods: 'Beni o servizi forniti',
    year: 'Anno fiscale',
    payments: 'Pagamenti',
    total: 'Totale',
  },
  exempt:
    '{charity} è esente dall’imposta federale sul reddito ai sensi della Sezione 501(c)(3) dell’Internal Revenue Code (EIN {ein}).',
  sponsored:
    '{charity} è un progetto con sponsorizzazione fiscale di {sponsor}, esente dall’imposta federale sul reddito ai sensi della Sezione 501(c)(3) dell’Internal Revenue Code (EIN {sponsorEin}). I contributi sono versati a {sponsor} a beneficio di {charity}.',
  noGoods: 'Non sono stati forniti beni o servizi in cambio di questo contributo.',
  quidProQuo:
    'In cambio di questo pagamento di {amount} hai ricevuto beni o servizi con un valore equo di mercato stimato di {fmv}. La parte del tuo contributo deducibile ai fini dell’imposta federale sul reddito è limitata a {deductible}.',
  notDeductible: 'Questo pagamento non è deducibile.',
  keep: 'Conserva questa ricevuta con i tuoi documenti fiscali.',
  statementIntro:
    'Grazie per il tuo sostegno. Questo riepilogo elenca i tuoi pagamenti deducibili a {charity} dal 1° gennaio al 31 dicembre {year}, come ricevuti al momento di ogni pagamento.',
  statementTotal: 'Importo deducibile totale per il {year}: {deductible}.',
  noticeTitle: 'Importo deducibile',
  notice:
    'Del tuo pagamento di {price}, {deductible} è deducibile. Il valore equo di mercato stimato dei beni e servizi che ricevi è {fmv}.',
  footer: 'Emessa da {charity}. Yayatoh gestisce pagamenti e ricevute per suo conto.',
};

const pt: ReceiptCopy = {
  receiptTitle: 'Recibo de doação',
  plainTitle: 'Recibo de pagamento',
  statementTitle: 'Extrato de doações de {year}',
  labels: {
    number: 'Número do recibo',
    date: 'Data do pagamento',
    donor: 'Recebido de',
    charity: 'Organização',
    ein: 'EIN',
    address: 'Endereço',
    event: 'Evento',
    amount: 'Valor pago',
    fmv: 'Valor justo de mercado dos bens ou serviços',
    deductible: 'Valor dedutível de impostos',
    goods: 'Bens ou serviços fornecidos',
    year: 'Ano fiscal',
    payments: 'Pagamentos',
    total: 'Total',
  },
  exempt:
    '{charity} é isenta do imposto de renda federal nos termos da Seção 501(c)(3) do Internal Revenue Code (EIN {ein}).',
  sponsored:
    '{charity} é um projeto com patrocínio fiscal de {sponsor}, isenta do imposto de renda federal nos termos da Seção 501(c)(3) do Internal Revenue Code (EIN {sponsorEin}). As contribuições são feitas a {sponsor} em benefício de {charity}.',
  noGoods: 'Nenhum bem ou serviço foi fornecido em troca desta contribuição.',
  quidProQuo:
    'Em troca deste pagamento de {amount}, você recebeu bens ou serviços com valor justo de mercado estimado em {fmv}. A parte da sua contribuição dedutível do imposto de renda federal está limitada a {deductible}.',
  notDeductible: 'Este pagamento não é dedutível de impostos.',
  keep: 'Guarde este recibo com os seus registros fiscais.',
  statementIntro:
    'Obrigado pelo seu apoio. Este extrato lista os seus pagamentos dedutíveis de impostos para {charity} de 1º de janeiro a 31 de dezembro de {year}, conforme os recibos emitidos em cada pagamento.',
  statementTotal: 'Valor total dedutível de impostos em {year}: {deductible}.',
  noticeTitle: 'Valor dedutível de impostos',
  notice:
    'Do seu pagamento de {price}, {deductible} é dedutível de impostos. O valor justo de mercado estimado dos bens e serviços que você recebe é {fmv}.',
  footer: 'Emitido por {charity}. A Yayatoh processa pagamentos e recibos em seu nome.',
};

const nl: ReceiptCopy = {
  receiptTitle: 'Donatiebewijs',
  plainTitle: 'Betalingsbewijs',
  statementTitle: 'Giftenoverzicht {year}',
  labels: {
    number: 'Bewijsnummer',
    date: 'Betaaldatum',
    donor: 'Ontvangen van',
    charity: 'Organisatie',
    ein: 'EIN',
    address: 'Adres',
    event: 'Evenement',
    amount: 'Betaald bedrag',
    fmv: 'Marktwaarde van goederen of diensten',
    deductible: 'Aftrekbaar bedrag',
    goods: 'Geleverde goederen of diensten',
    year: 'Belastingjaar',
    payments: 'Betalingen',
    total: 'Totaal',
  },
  exempt:
    '{charity} is vrijgesteld van Amerikaanse federale inkomstenbelasting onder Section 501(c)(3) van de Internal Revenue Code (EIN {ein}).',
  sponsored:
    '{charity} is een project onder fiscaal sponsorschap van {sponsor}, dat is vrijgesteld van Amerikaanse federale inkomstenbelasting onder Section 501(c)(3) van de Internal Revenue Code (EIN {sponsorEin}). Bijdragen gaan naar {sponsor} ten behoeve van {charity}.',
  noGoods: 'Voor deze bijdrage zijn geen goederen of diensten geleverd.',
  quidProQuo:
    'In ruil voor deze betaling van {amount} hebt u goederen of diensten ontvangen met een geschatte marktwaarde van {fmv}. Het deel van uw bijdrage dat aftrekbaar is voor de federale inkomstenbelasting is beperkt tot {deductible}.',
  notDeductible: 'Deze betaling is niet aftrekbaar.',
  keep: 'Bewaar dit bewijs bij uw belastingpapieren.',
  statementIntro:
    'Dank voor uw steun. Dit overzicht toont uw aftrekbare betalingen aan {charity} van 1 januari tot en met 31 december {year}, zoals bij elke betaling bevestigd.',
  statementTotal: 'Totaal aftrekbaar bedrag over {year}: {deductible}.',
  noticeTitle: 'Aftrekbaar bedrag',
  notice:
    'Van uw betaling van {price} is {deductible} aftrekbaar. De geschatte marktwaarde van de goederen en diensten die u ontvangt is {fmv}.',
  footer: 'Uitgegeven door {charity}. Yayatoh verwerkt betalingen en bewijzen namens haar.',
};

const ru: ReceiptCopy = {
  receiptTitle: 'Квитанция о пожертвовании',
  plainTitle: 'Квитанция об оплате',
  statementTitle: 'Сводка пожертвований за {year} год',
  labels: {
    number: 'Номер квитанции',
    date: 'Дата платежа',
    donor: 'Получено от',
    charity: 'Организация',
    ein: 'EIN',
    address: 'Адрес',
    event: 'Мероприятие',
    amount: 'Оплаченная сумма',
    fmv: 'Справедливая рыночная стоимость товаров или услуг',
    deductible: 'Сумма, вычитаемая из налогооблагаемой базы',
    goods: 'Предоставленные товары или услуги',
    year: 'Налоговый год',
    payments: 'Платежи',
    total: 'Итого',
  },
  exempt:
    '{charity} освобождена от федерального подоходного налога согласно разделу 501(c)(3) Налогового кодекса США (EIN {ein}).',
  sponsored:
    '{charity} — проект под фискальным спонсорством {sponsor}, организации, освобождённой от федерального подоходного налога согласно разделу 501(c)(3) Налогового кодекса США (EIN {sponsorEin}). Взносы перечисляются {sponsor} в пользу {charity}.',
  noGoods: 'В обмен на этот взнос не предоставлялись никакие товары или услуги.',
  quidProQuo:
    'В обмен на этот платёж в размере {amount} вы получили товары или услуги с оценочной справедливой рыночной стоимостью {fmv}. Часть вашего взноса, вычитаемая для целей федерального подоходного налога, ограничена суммой {deductible}.',
  notDeductible: 'Этот платёж не подлежит налоговому вычету.',
  keep: 'Сохраните эту квитанцию вместе с налоговыми документами.',
  statementIntro:
    'Спасибо за вашу поддержку. В этой сводке перечислены ваши платежи в пользу {charity}, подлежащие налоговому вычету, с 1 января по 31 декабря {year} года, согласно квитанциям, выданным при каждом платеже.',
  statementTotal: 'Общая сумма к налоговому вычету за {year} год: {deductible}.',
  noticeTitle: 'Сумма к налоговому вычету',
  notice:
    'Из вашего платежа в размере {price} налоговому вычету подлежит {deductible}. Оценочная справедливая рыночная стоимость получаемых вами товаров и услуг составляет {fmv}.',
  footer: 'Выдано организацией {charity}. Yayatoh обрабатывает платежи и квитанции от её имени.',
};

const ar: ReceiptCopy = {
  receiptTitle: 'إيصال تبرّع',
  plainTitle: 'إيصال دفع',
  statementTitle: 'كشف التبرعات لعام {year}',
  labels: {
    number: 'رقم الإيصال',
    date: 'تاريخ الدفع',
    donor: 'مستلَم من',
    charity: 'المنظمة',
    ein: 'رقم التعريف الضريبي (EIN)',
    address: 'العنوان',
    event: 'الفعالية',
    amount: 'المبلغ المدفوع',
    fmv: 'القيمة السوقية العادلة للسلع أو الخدمات',
    deductible: 'المبلغ القابل للخصم الضريبي',
    goods: 'السلع أو الخدمات المقدَّمة',
    year: 'السنة الضريبية',
    payments: 'المدفوعات',
    total: 'الإجمالي',
  },
  exempt:
    '{charity} معفاة من ضريبة الدخل الفيدرالية بموجب المادة 501(c)(3) من قانون الإيرادات الداخلية الأمريكي (EIN {ein}).',
  sponsored:
    '{charity} مشروع برعاية مالية من {sponsor}، وهي جهة معفاة من ضريبة الدخل الفيدرالية بموجب المادة 501(c)(3) من قانون الإيرادات الداخلية الأمريكي (EIN {sponsorEin}). تُقدَّم المساهمات إلى {sponsor} لصالح {charity}.',
  noGoods: 'لم تُقدَّم أي سلع أو خدمات مقابل هذه المساهمة.',
  quidProQuo:
    'مقابل هذه الدفعة البالغة {amount}، حصلت على سلع أو خدمات تبلغ قيمتها السوقية العادلة المقدّرة {fmv}. يقتصر الجزء من مساهمتك القابل للخصم من ضريبة الدخل الفيدرالية على {deductible}.',
  notDeductible: 'هذه الدفعة غير قابلة للخصم الضريبي.',
  keep: 'يُرجى الاحتفاظ بهذا الإيصال مع سجلاتك الضريبية.',
  statementIntro:
    'شكرًا لدعمك. يسرد هذا الكشف مدفوعاتك القابلة للخصم الضريبي إلى {charity} من 1 يناير إلى 31 ديسمبر {year}، كما وردت في الإيصالات عند كل دفعة.',
  statementTotal: 'إجمالي المبلغ القابل للخصم الضريبي لعام {year}: {deductible}.',
  noticeTitle: 'المبلغ القابل للخصم الضريبي',
  notice:
    'من دفعتك البالغة {price}، يُعدّ {deductible} قابلًا للخصم الضريبي. تبلغ القيمة السوقية العادلة المقدّرة للسلع والخدمات التي تحصل عليها {fmv}.',
  footer: 'صادر عن {charity}. تعالج Yayatoh المدفوعات والإيصالات نيابةً عنها.',
};

const hi: ReceiptCopy = {
  receiptTitle: 'दान रसीद',
  plainTitle: 'भुगतान रसीद',
  statementTitle: '{year} का दान विवरण',
  labels: {
    number: 'रसीद संख्या',
    date: 'भुगतान की तारीख',
    donor: 'प्राप्तकर्ता से',
    charity: 'संगठन',
    ein: 'EIN',
    address: 'पता',
    event: 'इवेंट',
    amount: 'भुगतान की गई राशि',
    fmv: 'वस्तुओं या सेवाओं का उचित बाज़ार मूल्य',
    deductible: 'कर-कटौती योग्य राशि',
    goods: 'प्रदान की गई वस्तुएँ या सेवाएँ',
    year: 'कर वर्ष',
    payments: 'भुगतान',
    total: 'कुल',
  },
  exempt: '{charity} आंतरिक राजस्व संहिता की धारा 501(c)(3) के तहत संघीय आयकर से मुक्त है (EIN {ein})।',
  sponsored:
    '{charity}, {sponsor} की वित्तीय प्रायोजित परियोजना है, जो आंतरिक राजस्व संहिता की धारा 501(c)(3) के तहत संघीय आयकर से मुक्त है (EIN {sponsorEin})। योगदान {charity} के लाभ के लिए {sponsor} को दिए जाते हैं।',
  noGoods: 'इस योगदान के बदले कोई वस्तु या सेवा प्रदान नहीं की गई।',
  quidProQuo:
    '{amount} के इस भुगतान के बदले आपको {fmv} के अनुमानित उचित बाज़ार मूल्य की वस्तुएँ या सेवाएँ मिलीं। आपके योगदान का संघीय आयकर के लिए कटौती योग्य भाग {deductible} तक सीमित है।',
  notDeductible: 'यह भुगतान कर-कटौती योग्य नहीं है।',
  keep: 'कृपया यह रसीद अपने कर रिकॉर्ड के साथ रखें।',
  statementIntro:
    'आपके समर्थन के लिए धन्यवाद। यह विवरण 1 जनवरी से 31 दिसंबर {year} तक {charity} को किए गए आपके कर-कटौती योग्य भुगतानों की सूची है, जैसा कि हर भुगतान के समय रसीद दी गई थी।',
  statementTotal: '{year} की कुल कर-कटौती योग्य राशि: {deductible}।',
  noticeTitle: 'कर-कटौती योग्य राशि',
  notice:
    'आपके {price} के भुगतान में से {deductible} कर-कटौती योग्य है। आपको मिलने वाली वस्तुओं और सेवाओं का अनुमानित उचित बाज़ार मूल्य {fmv} है।',
  footer: '{charity} द्वारा जारी। Yayatoh उसकी ओर से भुगतान और रसीदें संसाधित करता है।',
};

const ja: ReceiptCopy = {
  receiptTitle: '寄付の領収書',
  plainTitle: 'お支払いの領収書',
  statementTitle: '{year}年 寄付明細書',
  labels: {
    number: '領収書番号',
    date: 'お支払い日',
    donor: '受領元',
    charity: '団体',
    ein: 'EIN',
    address: '住所',
    event: 'イベント',
    amount: 'お支払い金額',
    fmv: '物品またはサービスの公正市場価格',
    deductible: '税控除対象額',
    goods: '提供された物品またはサービス',
    year: '課税年度',
    payments: 'お支払い',
    total: '合計',
  },
  exempt: '{charity}は米国内国歳入法第501条(c)(3)に基づき連邦所得税が免除されています（EIN {ein}）。',
  sponsored:
    '{charity}は{sponsor}の財政支援プロジェクトです。{sponsor}は米国内国歳入法第501条(c)(3)に基づき連邦所得税が免除されています（EIN {sponsorEin}）。寄付は{charity}のために{sponsor}に対して行われます。',
  noGoods: 'この寄付の見返りとして物品やサービスは提供されていません。',
  quidProQuo:
    'このお支払い{amount}の見返りとして、推定公正市場価格{fmv}の物品またはサービスを受け取りました。連邦所得税上控除できる寄付額は{deductible}までです。',
  notDeductible: 'このお支払いは税控除の対象外です。',
  keep: 'この領収書は税務記録と一緒に保管してください。',
  statementIntro:
    'ご支援ありがとうございます。この明細書には、{year}年1月1日から12月31日までの{charity}への税控除対象のお支払いを、各お支払い時の領収書のとおりに記載しています。',
  statementTotal: '{year}年の税控除対象額の合計：{deductible}。',
  noticeTitle: '税控除対象額',
  notice:
    'お支払い{price}のうち、{deductible}が税控除の対象です。受け取る物品とサービスの推定公正市場価格は{fmv}です。',
  footer: '{charity}発行。Yayatohが同団体に代わって支払いと領収書を処理しています。',
};

const zhCN: ReceiptCopy = {
  receiptTitle: '捐赠收据',
  plainTitle: '付款收据',
  statementTitle: '{year} 年捐赠明细',
  labels: {
    number: '收据编号',
    date: '付款日期',
    donor: '付款人',
    charity: '组织',
    ein: 'EIN',
    address: '地址',
    event: '活动',
    amount: '付款金额',
    fmv: '商品或服务的公允市场价值',
    deductible: '可抵税金额',
    goods: '提供的商品或服务',
    year: '纳税年度',
    payments: '付款',
    total: '合计',
  },
  exempt: '{charity} 依据美国《国内税收法》第 501(c)(3) 条免缴联邦所得税（EIN {ein}）。',
  sponsored:
    '{charity} 是 {sponsor} 财务赞助的项目，{sponsor} 依据美国《国内税收法》第 501(c)(3) 条免缴联邦所得税（EIN {sponsorEin}）。捐款付给 {sponsor}，用于 {charity}。',
  noGoods: '此笔捐款未换取任何商品或服务。',
  quidProQuo:
    '作为这笔 {amount} 付款的回报，您获得了估计公允市场价值为 {fmv} 的商品或服务。您的捐款中可在联邦所得税中扣除的部分以 {deductible} 为限。',
  notDeductible: '此笔付款不可抵税。',
  keep: '请将此收据与您的税务记录一起保存。',
  statementIntro:
    '感谢您的支持。本明细列出了您在 {year} 年 1 月 1 日至 12 月 31 日期间向 {charity} 支付的可抵税款项，以每笔付款时开具的收据为准。',
  statementTotal: '{year} 年可抵税总额：{deductible}。',
  noticeTitle: '可抵税金额',
  notice: '在您 {price} 的付款中，{deductible} 可抵税。您获得的商品和服务的估计公允市场价值为 {fmv}。',
  footer: '由 {charity} 开具。Yayatoh 代其处理付款和收据。',
};

const zhTW: ReceiptCopy = {
  receiptTitle: '捐款收據',
  plainTitle: '付款收據',
  statementTitle: '{year} 年捐款明細',
  labels: {
    number: '收據編號',
    date: '付款日期',
    donor: '付款人',
    charity: '組織',
    ein: 'EIN',
    address: '地址',
    event: '活動',
    amount: '付款金額',
    fmv: '商品或服務的公平市場價值',
    deductible: '可抵稅金額',
    goods: '提供的商品或服務',
    year: '課稅年度',
    payments: '付款',
    total: '合計',
  },
  exempt: '{charity} 依據美國《國內稅收法》第 501(c)(3) 條免繳聯邦所得稅（EIN {ein}）。',
  sponsored:
    '{charity} 是 {sponsor} 財務贊助的專案，{sponsor} 依據美國《國內稅收法》第 501(c)(3) 條免繳聯邦所得稅（EIN {sponsorEin}）。捐款付給 {sponsor}，用於 {charity}。',
  noGoods: '此筆捐款未換取任何商品或服務。',
  quidProQuo:
    '作為這筆 {amount} 付款的回報，您獲得了估計公平市場價值為 {fmv} 的商品或服務。您的捐款中可在聯邦所得稅中扣除的部分以 {deductible} 為限。',
  notDeductible: '此筆付款不可抵稅。',
  keep: '請將此收據與您的稅務紀錄一併保存。',
  statementIntro:
    '感謝您的支持。本明細列出您在 {year} 年 1 月 1 日至 12 月 31 日期間向 {charity} 支付的可抵稅款項，以每筆付款時開立的收據為準。',
  statementTotal: '{year} 年可抵稅總額：{deductible}。',
  noticeTitle: '可抵稅金額',
  notice: '在您 {price} 的付款中，{deductible} 可抵稅。您獲得的商品和服務的估計公平市場價值為 {fmv}。',
  footer: '由 {charity} 開立。Yayatoh 代其處理付款和收據。',
};

export const RECEIPT_COPY: Readonly<Record<Locale, ReceiptCopy>> = {
  en,
  es,
  fr,
  de,
  it,
  pt,
  nl,
  ru,
  ar,
  hi,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};
