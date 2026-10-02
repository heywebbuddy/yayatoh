import { randomBytes, randomUUID } from 'node:crypto';
import type { Planter } from '../types.ts';
import { ensureSpeaker, portalAccountOf } from './program.ts';

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

/**
 * media: the person's portal uploads (their slides, answering the program planter's task, and a
 * proposed headshot) and the photo of the speaker row that is them, with its fallback variant.
 */
export const plantMedia: Planter = async (p) => {
  const { admin, orgId, person, ids } = p;
  const speakerId = await ensureSpeaker(p);
  const by = `portal:${portalAccountOf(ids)}`;
  ids.speakerFileId ??= randomUUID();
  const files = [
    {
      id: ids.speakerFileId,
      purpose: 'task_answer',
      owner: ids.speakerTaskAssigneeId ?? speakerId,
      type: 'pdf',
    },
    { id: randomUUID(), purpose: 'speaker_photo', owner: speakerId, type: 'jpeg' },
  ];
  for (const f of files) {
    const ext = f.type === 'jpeg' ? 'jpg' : f.type;
    await admin`
      insert into media.portal_files
        (id, org_id, purpose, owner_id, file_type, file_name, storage_key, sha256, bytes, created_by)
      values (${f.id}, ${orgId}, ${f.purpose}, ${f.owner}, ${f.type}, ${`${person.lastName}-${f.purpose}.${ext}`},
        ${`${orgId}/${f.id}/f-${hex(16)}.${ext}`}, ${hex(32)}, 1024, ${by})`;
  }
  const [asset] = await admin`
    insert into media.assets (org_id, owner_type, owner_id, slot, source_type, width, height, alt, bytes)
    values (${orgId}, 'speaker', ${speakerId}, 'photo', 'jpeg', 400, 400, ${`Photo of ${person.name}`}, 2048)
    returning id`;
  await admin`
    insert into media.variants (org_id, asset_id, format, width, height, bytes, sha256, file_name, fallback)
    values (${orgId}, ${asset?.id as string}, 'jpeg', 400, 400, 2048, ${hex(32)}, ${`400-${hex(16)}.jpg`}, true)`;
  return ['media.portal_files', 'media.assets', 'media.variants'];
};
