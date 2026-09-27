# forms (tier 1)

Organizer-defined questions (v1: event checkout questions). Owns Postgres schema `forms`.

**Invariants**
- A form belongs to one subject (`subject_type`, `subject_id`) and kind; every change writes a new, immutable `form_versions` row. Responses point at the exact version answered, so later edits never reinterpret old answers.
- Definitions are validated on publish (unique keys, options only on choice fields, conditions limited to a safe JsonLogic subset: `var == != > >= < <= in and or !`).
- Answers are validated server-side against the current version; fields hidden by their condition are dropped, unknown keys rejected. Sensitive answers are stored as one KeyVault envelope.
- v1 stores a response's answers as JSON on the response row; a normalized `form_answers` table arrives with reporting (M3+).
