import type { Planter } from '../types.ts';

/**
 * forms: checkout answers in the person's order, and a registration-form respondent (draft
 * answers) with a submitted response.
 */
export const plantForms: Planter = async ({ admin, orgId, person, ids }) => {
  if (!ids.orderId) throw new Error('plantForms: run plantOrders first');
  const [v] = await admin`
    select v.id, v.form_id from forms.form_versions v join forms.forms f on f.id = v.form_id and f.org_id = v.org_id
    where v.org_id = ${orgId} order by (f.kind = 'checkout_questions') desc, v.version desc limit 1`;
  if (!v) throw new Error('plantForms: the fixture has no form version');
  const answers = (note: string) => JSON.stringify({ note, phone: person.phone });
  await admin`
    insert into forms.form_responses (org_id, form_version_id, respondent_type, respondent_id, answers)
    values (${orgId}, ${v.id as string}, 'order', ${ids.orderId}, ${answers(`Seat me next to ${person.name}`)}::jsonb)
    on conflict (org_id, form_version_id, respondent_type, respondent_id) do update set answers = excluded.answers`;
  const [r] = await admin`
    insert into forms.respondents (org_id, form_id, form_version_id, registration_type_id, name, email, locale, answers, expires_at)
    values (${orgId}, ${v.form_id as string}, ${v.id as string}, 'standard', ${person.name}, ${person.email.toUpperCase()}, 'en',
      ${answers(`Draft by ${person.lastName}`)}::jsonb, now() + interval '1 day')
    returning id`;
  ids.formRespondentId = r?.id as string;
  await admin`
    insert into forms.form_responses (org_id, form_version_id, respondent_type, respondent_id, answers)
    values (${orgId}, ${v.id as string}, 'form_respondent', ${ids.formRespondentId}, ${answers(`Company of ${person.lastName}`)}::jsonb)`;
  return ['forms.form_responses', 'forms.respondents'];
};
