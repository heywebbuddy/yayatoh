# forms (tier 1)

Organizer-defined questions: event checkout questions, survey questions (M3.9a, `@yayatoh/surveys`) and multi-page registration forms (M5.1b). Owns Postgres schema `forms`.

**Invariants**
- A form belongs to one subject (`subject_type`, `subject_id`) and kind; every change writes a new, immutable `form_versions` row. Responses point at the exact version answered, so later edits never reinterpret old answers.
- Definitions are validated on publish (unique keys, options only on choice fields, conditions limited to a safe JsonLogic subset: `var == != > >= < <= in and or !`).
- Answers are validated server-side against the current version; fields hidden by their condition are dropped, unknown keys rejected. Sensitive answers are stored as one KeyVault envelope.
- Question types per kind: checkout questions use `FIELD_TYPES`; surveys add the `rating` (1–5) and `nps` (0–10) scales and never hold sensitive answers (both checked on publish).
- v1 stores a response's answers as JSON on the response row; a normalized `form_answers` table arrives with reporting (M3+).

**Registration forms (M5.1b, kind `registration`)**
- Pages (1–20) with questions, page conditions and per-registration-type limits. Registration types are opaque ids the caller supplies (`registrationTypeId`); this module never reads another module's types. Conditions only read earlier questions (checked on publish).
- The server recomputes the path (`checkRegistrationAnswers`) and **rejects** any answer off it, naming the question (the checkout and survey kinds keep dropping hidden answers). Required questions are enforced on visible pages.
- `forms.respondents`: one row per person, pinned to the version they started; draft answers (sensitive ones in one KeyVault envelope) until submit, then one `form_responses` row (respondent `form_respondent`) and the draft emptied. The link is `<id>~<hmac>` (purpose `forms.respondent`); `forms.respondent_org()` (SECURITY DEFINER, ids of live orgs) resolves the org. Drafts expire 14 days after the last save and are deleted by retention.
- Consent questions pin a crm consent term and version; checked boxes are recorded through the `recordConsent` port (`@yayatoh/crm` `recordTermConsentTx`) on submit, unchecked ones record nothing.
- `forms.job_titles` (the org's list) and `forms.companies` (names submitted, counted; suggested only from two respondents up).
- Publishing takes an optional `expectedVersion`: a publish from a stale version is a `conflict` (`stale_version`).
