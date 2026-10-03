import { type SeriesDetailDto, seriesDetailQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { loadConsole } from '@/server/console.ts';
import { ports } from '@/server/ports.ts';

/** U7: one of the org's series with its events (any status), or a 404. */
export const loadSeries = cache(async (org: string, slug: string) => {
  const data = await loadConsole(org);
  let series: SeriesDetailDto;
  try {
    series = await executeQuery(seriesDetailQuery, { slug }, data.ctx, ports);
  } catch (err) {
    if (isDomainError(err) && (err.code === 'not_found' || err.code === 'validation_failed')) notFound();
    throw err;
  }
  return { data, series };
});
