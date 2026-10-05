import 'server-only';
import type { BoothPlanDto, BoothWarningDto } from '@yayatoh/program';
import { getTranslations } from 'next-intl/server';

/** Localized booth-plan warnings (M5.4a conflicts), naming the booths and exhibitors involved. */
export async function boothWarningMessages(
  plan: BoothPlanDto,
  exhibitorName: (id: string) => string = () => '—',
  only?: (w: BoothWarningDto) => boolean,
): Promise<string[]> {
  const t = await getTranslations('booths.warnings');
  const number = (id: string | null) => plan.booths.find((b) => b.id === id)?.number ?? '—';
  return plan.warnings
    .filter((w) => (only ? only(w) : true))
    .map((w) =>
      w.kind === 'booths_overlap'
        ? t('booths_overlap', { booth: number(w.boothId), other: number(w.otherBoothId) })
        : w.kind === 'shared_booth'
          ? t('shared_booth', {
              booth: number(w.boothId),
              count: plan.booths.find((b) => b.id === w.boothId)?.exhibitors.length ?? 2,
            })
          : w.kind === 'several_booths'
            ? t('several_booths', { exhibitor: exhibitorName(w.exhibitorId ?? '') })
            : t('category_mismatch', {
                booth: number(w.boothId),
                exhibitor: exhibitorName(w.exhibitorId ?? ''),
                category: plan.booths.find((b) => b.id === w.boothId)?.category ?? '',
              }),
    );
}
