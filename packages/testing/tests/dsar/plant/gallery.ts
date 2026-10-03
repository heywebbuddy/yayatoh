import type { Planter } from '../types.ts';

/**
 * gallery (M4.5b, batch 3u merge): the fixture's first guest uploader signed with the person's full
 * name, and a caption naming them on what it uploaded.
 */
export const plantGallery: Planter = async ({ admin, orgId, person }) => {
  const [u] = await admin`
    update gallery.uploaders set display_name = ${person.name}
    where id = (select id from gallery.uploaders where org_id = ${orgId} and kind = 'guest' order by created_at limit 1)
    returning id`;
  if (!u) return [];
  const captioned = await admin`
    update gallery.items set caption = ${`Dancing with ${person.name}`}
    where org_id = ${orgId} and uploader_id = ${u.id as string} returning id`;
  return captioned.length ? ['gallery.uploaders', 'gallery.items'] : ['gallery.uploaders'];
};
