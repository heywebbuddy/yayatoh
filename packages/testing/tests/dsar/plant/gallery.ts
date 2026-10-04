import type { Planter } from '../types.ts';

/**
 * gallery (M4.5b; batch 3j merge): a guest uploader under the person's full name, with a caption
 * naming them on their photo (deleted on erasure).
 */
export const plantGallery: Planter = async ({ admin, orgId, person }) => {
  const [u] = await admin`
    update gallery.uploaders set display_name = ${person.name}
    where id = (select id from gallery.uploaders where org_id = ${orgId} and kind = 'guest' order by created_at limit 1)
    returning id`;
  if (!u) return [];
  await admin`
    update gallery.items set caption = ${`${person.name} at the party`}
    where org_id = ${orgId} and uploader_id = ${u.id as string}`;
  return ['gallery.uploaders', 'gallery.items'];
};
