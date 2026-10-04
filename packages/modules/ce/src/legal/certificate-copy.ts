/**
 * LEGAL-COPY — PLACEHOLDER WORDING FOR COUNSEL'S REVIEW (label `legal-copy`, M6.9b).
 *
 * Every word a CE (continuing education) certificate and its verification page say lives in this
 * one file, so counsel can review it in one place. None of it is final: the accreditation
 * statement in particular is a placeholder. Whether a certificate may name an accrediting body,
 * and in which words, depends on that body's rules (ACCME, NASBA, state boards …) and on the
 * organizer's own accreditation, which Yayatoh does not check. The certificate is the organizer's
 * statement of attendance, not Yayatoh's (pending counsel: docs/owner-inbox.md).
 *
 * The English text is the source; the other 12 locales are courtesy translations of it. Bump
 * `CERTIFICATE_COPY_VERSION` on any change: every certificate stores the version it was issued
 * with.
 *
 * Placeholders (ICU): {name} {event} {org} {credits} {label} {accreditor} {code} {url} {revision}.
 */
import type { Locale } from '@yayatoh/contracts';

export const CERTIFICATE_COPY_VERSION = '2026-10-03.1';

export interface CertificateCopy {
  readonly title: string;
  /** The default credit name when the organizer set none. */
  readonly defaultLabel: string;
  readonly certifies: string;
  readonly attended: string;
  readonly earned: string;
  readonly labels: {
    readonly session: string;
    readonly date: string;
    readonly inPerson: string;
    readonly online: string;
    readonly minutes: string;
    readonly credits: string;
    readonly total: string;
    readonly code: string;
    readonly issued: string;
    readonly revision: string;
  };
  /** PLACEHOLDER: the accreditation statement (only when the organizer names an accreditor). */
  readonly accreditation: string;
  /** PLACEHOLDER: how the credits were determined. */
  readonly basis: string;
  readonly verify: string;
  readonly revoked: string;
  readonly footer: string;
}

const en: CertificateCopy = {
  title: 'Certificate of attendance',
  defaultLabel: 'CE credits',
  certifies: 'This certifies that',
  attended: 'attended {event}, organized by {org},',
  earned: 'and earned {credits} {label}.',
  labels: {
    session: 'Session',
    date: 'Date',
    inPerson: 'In person (min)',
    online: 'Online (min)',
    minutes: 'Counted (min)',
    credits: 'Credits',
    total: 'Total',
    code: 'Verification code',
    issued: 'Issued',
    revision: 'Revision',
  },
  accreditation:
    '{org} states that these credits are awarded under its accreditation with {accreditor}. Accreditation is the organizer’s responsibility.',
  basis:
    'Credits are based on session check-in scans and online watch time recorded for this attendee, counted once per minute, against the minimum attendance the organizer set for each session.',
  verify: 'Check this certificate at {url} with the code {code}.',
  revoked: 'This certificate has been withdrawn by the organizer.',
  footer: 'Issued by {org}. Yayatoh records attendance and issues certificates on its behalf.',
};

const ar: CertificateCopy = {
  title: 'شهادة حضور',
  defaultLabel: 'ساعات التعليم المستمر',
  certifies: 'تشهد هذه الوثيقة بأن',
  attended: 'حضر {event}، الذي نظمته {org}،',
  earned: 'وحصل على {credits} {label}.',
  labels: {
    session: 'الجلسة',
    date: 'التاريخ',
    inPerson: 'حضوريًا (دقيقة)',
    online: 'عبر الإنترنت (دقيقة)',
    minutes: 'المحتسب (دقيقة)',
    credits: 'الساعات',
    total: 'المجموع',
    code: 'رمز التحقق',
    issued: 'تاريخ الإصدار',
    revision: 'المراجعة',
  },
  accreditation:
    'تقر {org} بأن هذه الساعات تُمنح بموجب اعتمادها لدى {accreditor}. الاعتماد مسؤولية الجهة المنظمة.',
  basis:
    'تستند الساعات إلى عمليات مسح تسجيل الحضور في الجلسات ووقت المشاهدة عبر الإنترنت المسجلين لهذا الحاضر، وتُحتسب مرة واحدة لكل دقيقة، مقارنةً بالحد الأدنى للحضور الذي حددته الجهة المنظمة لكل جلسة.',
  verify: 'تحقق من هذه الشهادة على {url} باستخدام الرمز {code}.',
  revoked: 'سحبت الجهة المنظمة هذه الشهادة.',
  footer: 'صادرة عن {org}. تسجل Yayatoh الحضور وتصدر الشهادات نيابةً عنها.',
};

const de: CertificateCopy = {
  title: 'Teilnahmebescheinigung',
  defaultLabel: 'Fortbildungspunkte',
  certifies: 'Hiermit wird bescheinigt, dass',
  attended: 'an {event}, veranstaltet von {org}, teilgenommen',
  earned: 'und {credits} {label} erworben hat.',
  labels: {
    session: 'Sitzung',
    date: 'Datum',
    inPerson: 'Vor Ort (Min.)',
    online: 'Online (Min.)',
    minutes: 'Angerechnet (Min.)',
    credits: 'Punkte',
    total: 'Gesamt',
    code: 'Prüfcode',
    issued: 'Ausgestellt',
    revision: 'Fassung',
  },
  accreditation:
    '{org} erklärt, dass diese Punkte im Rahmen ihrer Akkreditierung bei {accreditor} vergeben werden. Die Akkreditierung liegt in der Verantwortung des Veranstalters.',
  basis:
    'Die Punkte beruhen auf den für diese Person erfassten Check-in-Scans der Sitzungen und der Online-Zuschauzeit, je Minute einmal gezählt, gemessen an der Mindestteilnahme, die der Veranstalter für jede Sitzung festgelegt hat.',
  verify: 'Prüfen Sie diese Bescheinigung unter {url} mit dem Code {code}.',
  revoked: 'Diese Bescheinigung wurde vom Veranstalter zurückgezogen.',
  footer:
    'Ausgestellt von {org}. Yayatoh erfasst die Teilnahme und stellt Bescheinigungen in dessen Auftrag aus.',
};

const es: CertificateCopy = {
  title: 'Certificado de asistencia',
  defaultLabel: 'créditos de formación continua',
  certifies: 'Se certifica que',
  attended: 'asistió a {event}, organizado por {org},',
  earned: 'y obtuvo {credits} {label}.',
  labels: {
    session: 'Sesión',
    date: 'Fecha',
    inPerson: 'Presencial (min)',
    online: 'En línea (min)',
    minutes: 'Computado (min)',
    credits: 'Créditos',
    total: 'Total',
    code: 'Código de verificación',
    issued: 'Emitido',
    revision: 'Revisión',
  },
  accreditation:
    '{org} declara que estos créditos se otorgan en virtud de su acreditación ante {accreditor}. La acreditación es responsabilidad del organizador.',
  basis:
    'Los créditos se basan en los escaneos de registro de las sesiones y el tiempo de visualización en línea registrados para este asistente, contados una vez por minuto, frente a la asistencia mínima que el organizador fijó para cada sesión.',
  verify: 'Compruebe este certificado en {url} con el código {code}.',
  revoked: 'El organizador ha retirado este certificado.',
  footer: 'Emitido por {org}. Yayatoh registra la asistencia y emite los certificados en su nombre.',
};

const fr: CertificateCopy = {
  title: 'Attestation de présence',
  defaultLabel: 'crédits de formation continue',
  certifies: 'Nous attestons que',
  attended: 'a assisté à {event}, organisé par {org},',
  earned: 'et a obtenu {credits} {label}.',
  labels: {
    session: 'Session',
    date: 'Date',
    inPerson: 'Sur place (min)',
    online: 'En ligne (min)',
    minutes: 'Retenu (min)',
    credits: 'Crédits',
    total: 'Total',
    code: 'Code de vérification',
    issued: 'Délivrée le',
    revision: 'Version',
  },
  accreditation:
    '{org} déclare que ces crédits sont attribués au titre de son accréditation auprès de {accreditor}. L’accréditation relève de la responsabilité de l’organisateur.',
  basis:
    'Les crédits reposent sur les scans d’enregistrement aux sessions et le temps de visionnage en ligne enregistrés pour ce participant, comptés une fois par minute, au regard de la présence minimale fixée par l’organisateur pour chaque session.',
  verify: 'Vérifiez cette attestation sur {url} avec le code {code}.',
  revoked: 'Cette attestation a été retirée par l’organisateur.',
  footer: 'Délivrée par {org}. Yayatoh enregistre la présence et délivre les attestations pour son compte.',
};

const hi: CertificateCopy = {
  title: 'उपस्थिति प्रमाणपत्र',
  defaultLabel: 'सतत शिक्षा क्रेडिट',
  certifies: 'यह प्रमाणित किया जाता है कि',
  attended: 'ने {org} द्वारा आयोजित {event} में भाग लिया',
  earned: 'और {credits} {label} अर्जित किए।',
  labels: {
    session: 'सत्र',
    date: 'तारीख',
    inPerson: 'व्यक्तिगत रूप से (मिनट)',
    online: 'ऑनलाइन (मिनट)',
    minutes: 'गिने गए (मिनट)',
    credits: 'क्रेडिट',
    total: 'कुल',
    code: 'सत्यापन कोड',
    issued: 'जारी',
    revision: 'संशोधन',
  },
  accreditation:
    '{org} बताता है कि ये क्रेडिट {accreditor} के साथ उसकी मान्यता के अंतर्गत दिए जाते हैं। मान्यता आयोजक की ज़िम्मेदारी है।',
  basis:
    'क्रेडिट इस प्रतिभागी के लिए दर्ज सत्र चेक-इन स्कैन और ऑनलाइन देखने के समय पर आधारित हैं, प्रति मिनट एक बार गिने जाते हैं, और आयोजक द्वारा हर सत्र के लिए तय न्यूनतम उपस्थिति से मिलाए जाते हैं।',
  verify: 'इस प्रमाणपत्र को {url} पर कोड {code} से जाँचें।',
  revoked: 'आयोजक ने यह प्रमाणपत्र वापस ले लिया है।',
  footer: '{org} द्वारा जारी। Yayatoh उसकी ओर से उपस्थिति दर्ज करता है और प्रमाणपत्र जारी करता है।',
};

const it: CertificateCopy = {
  title: 'Attestato di partecipazione',
  defaultLabel: 'crediti formativi',
  certifies: 'Si attesta che',
  attended: 'ha partecipato a {event}, organizzato da {org},',
  earned: 'e ha ottenuto {credits} {label}.',
  labels: {
    session: 'Sessione',
    date: 'Data',
    inPerson: 'In presenza (min)',
    online: 'Online (min)',
    minutes: 'Conteggiati (min)',
    credits: 'Crediti',
    total: 'Totale',
    code: 'Codice di verifica',
    issued: 'Rilasciato',
    revision: 'Revisione',
  },
  accreditation:
    '{org} dichiara che questi crediti sono assegnati in base al proprio accreditamento presso {accreditor}. L’accreditamento è responsabilità dell’organizzatore.',
  basis:
    'I crediti si basano sulle scansioni di check-in alle sessioni e sul tempo di visione online registrati per questo partecipante, contati una volta al minuto, rispetto alla presenza minima fissata dall’organizzatore per ogni sessione.',
  verify: 'Verifica questo attestato su {url} con il codice {code}.',
  revoked: 'Questo attestato è stato ritirato dall’organizzatore.',
  footer: 'Rilasciato da {org}. Yayatoh registra le presenze e rilascia gli attestati per suo conto.',
};

const ja: CertificateCopy = {
  title: '参加証明書',
  defaultLabel: '継続教育単位',
  certifies: '以下の者が',
  attended: '{org} 主催の {event} に参加し、',
  earned: '{credits} {label}を取得したことを証明します。',
  labels: {
    session: 'セッション',
    date: '日付',
    inPerson: '会場参加（分）',
    online: 'オンライン（分）',
    minutes: '算入（分）',
    credits: '単位',
    total: '合計',
    code: '確認コード',
    issued: '発行日',
    revision: '改訂',
  },
  accreditation:
    '{org} は、これらの単位が {accreditor} による同団体の認定に基づき付与されるものであることを表明します。認定は主催者の責任です。',
  basis:
    '単位は、この参加者について記録されたセッションのチェックインスキャンとオンライン視聴時間に基づき、1 分につき 1 回算入し、主催者が各セッションに設定した最低参加時間と照らして決定されます。',
  verify: 'この証明書は {url} でコード {code} を使って確認できます。',
  revoked: 'この証明書は主催者により取り消されました。',
  footer: '{org} が発行。Yayatoh が同団体に代わって参加を記録し、証明書を発行します。',
};

const nl: CertificateCopy = {
  title: 'Bewijs van deelname',
  defaultLabel: 'nascholingspunten',
  certifies: 'Hierbij wordt verklaard dat',
  attended: 'heeft deelgenomen aan {event}, georganiseerd door {org},',
  earned: 'en {credits} {label} heeft behaald.',
  labels: {
    session: 'Sessie',
    date: 'Datum',
    inPerson: 'Ter plaatse (min)',
    online: 'Online (min)',
    minutes: 'Geteld (min)',
    credits: 'Punten',
    total: 'Totaal',
    code: 'Verificatiecode',
    issued: 'Uitgegeven',
    revision: 'Versie',
  },
  accreditation:
    '{org} verklaart dat deze punten worden toegekend op grond van haar accreditatie bij {accreditor}. Accreditatie is de verantwoordelijkheid van de organisator.',
  basis:
    'De punten zijn gebaseerd op de check-inscans bij sessies en de online kijktijd die voor deze deelnemer zijn vastgelegd, één keer per minuut geteld, ten opzichte van de minimale aanwezigheid die de organisator per sessie heeft ingesteld.',
  verify: 'Controleer dit bewijs op {url} met de code {code}.',
  revoked: 'Dit bewijs is door de organisator ingetrokken.',
  footer: 'Uitgegeven door {org}. Yayatoh registreert de aanwezigheid en geeft bewijzen namens hen uit.',
};

const pt: CertificateCopy = {
  title: 'Certificado de participação',
  defaultLabel: 'créditos de educação continuada',
  certifies: 'Certificamos que',
  attended: 'participou de {event}, organizado por {org},',
  earned: 'e obteve {credits} {label}.',
  labels: {
    session: 'Sessão',
    date: 'Data',
    inPerson: 'Presencial (min)',
    online: 'On-line (min)',
    minutes: 'Contabilizado (min)',
    credits: 'Créditos',
    total: 'Total',
    code: 'Código de verificação',
    issued: 'Emitido em',
    revision: 'Revisão',
  },
  accreditation:
    '{org} declara que estes créditos são concedidos ao abrigo da sua acreditação junto a {accreditor}. A acreditação é responsabilidade do organizador.',
  basis:
    'Os créditos baseiam-se nas leituras de check-in das sessões e no tempo de visualização on-line registrados para este participante, contados uma vez por minuto, em relação à presença mínima que o organizador definiu para cada sessão.',
  verify: 'Verifique este certificado em {url} com o código {code}.',
  revoked: 'Este certificado foi retirado pelo organizador.',
  footer: 'Emitido por {org}. A Yayatoh registra a presença e emite certificados em seu nome.',
};

const ru: CertificateCopy = {
  title: 'Сертификат участия',
  defaultLabel: 'баллы непрерывного образования',
  certifies: 'Настоящим подтверждается, что',
  attended: 'посетил(а) {event}, организатор — {org},',
  earned: 'и получил(а) {credits} {label}.',
  labels: {
    session: 'Сессия',
    date: 'Дата',
    inPerson: 'Очно (мин)',
    online: 'Онлайн (мин)',
    minutes: 'Засчитано (мин)',
    credits: 'Баллы',
    total: 'Итого',
    code: 'Код проверки',
    issued: 'Выдан',
    revision: 'Редакция',
  },
  accreditation:
    '{org} заявляет, что эти баллы присуждаются в рамках её аккредитации в {accreditor}. Ответственность за аккредитацию несёт организатор.',
  basis:
    'Баллы основаны на отметках входа на сессии и времени онлайн-просмотра, записанных для этого участника, по одному разу за минуту, в сравнении с минимальным присутствием, которое организатор установил для каждой сессии.',
  verify: 'Проверьте этот сертификат на {url} с кодом {code}.',
  revoked: 'Организатор отозвал этот сертификат.',
  footer: 'Выдан {org}. Yayatoh учитывает посещаемость и выдаёт сертификаты от его имени.',
};

const zhCN: CertificateCopy = {
  title: '参会证明',
  defaultLabel: '继续教育学分',
  certifies: '兹证明',
  attended: '参加了由 {org} 主办的 {event}，',
  earned: '并获得 {credits} {label}。',
  labels: {
    session: '场次',
    date: '日期',
    inPerson: '现场（分钟）',
    online: '线上（分钟）',
    minutes: '计入（分钟）',
    credits: '学分',
    total: '合计',
    code: '验证码',
    issued: '签发日期',
    revision: '修订',
  },
  accreditation: '{org} 声明，这些学分依据其在 {accreditor} 的认证授予。认证由主办方负责。',
  basis:
    '学分依据为该参会者记录的场次签到扫描和线上观看时长，每分钟计一次，并对照主办方为每个场次设定的最低出席时长。',
  verify: '请在 {url} 使用验证码 {code} 核验本证明。',
  revoked: '主办方已撤回本证明。',
  footer: '由 {org} 签发。Yayatoh 代表其记录出席情况并签发证明。',
};

const zhTW: CertificateCopy = {
  title: '參加證明',
  defaultLabel: '繼續教育學分',
  certifies: '茲證明',
  attended: '參加了由 {org} 主辦的 {event}，',
  earned: '並獲得 {credits} {label}。',
  labels: {
    session: '場次',
    date: '日期',
    inPerson: '現場（分鐘）',
    online: '線上（分鐘）',
    minutes: '計入（分鐘）',
    credits: '學分',
    total: '合計',
    code: '驗證碼',
    issued: '簽發日期',
    revision: '修訂',
  },
  accreditation: '{org} 聲明，這些學分依據其在 {accreditor} 的認證授予。認證由主辦方負責。',
  basis:
    '學分依據為該參加者記錄的場次報到掃描和線上觀看時長，每分鐘計一次，並對照主辦方為每個場次設定的最低出席時長。',
  verify: '請在 {url} 使用驗證碼 {code} 核驗本證明。',
  revoked: '主辦方已撤回本證明。',
  footer: '由 {org} 簽發。Yayatoh 代表其記錄出席情況並簽發證明。',
};

export const CERTIFICATE_COPY: Readonly<Record<Locale, CertificateCopy>> = {
  en,
  ar,
  de,
  es,
  fr,
  hi,
  it,
  ja,
  nl,
  pt,
  ru,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};
