/** What the conference hub's forms return (M5.10a). */
export interface FavoriteActionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly favorite?: boolean;
  /** How many overlapping favorites "replace" un-starred. */
  readonly removed?: number;
  readonly reason?: string;
  /** The sessions in the way of a new favorite. */
  readonly conflicts?: readonly { readonly title: string; readonly kind: 'enrolled' | 'favorite' }[];
  /** "Replace" is offered (only favorites are in the way). */
  readonly replace?: boolean;
  readonly stamp?: number;
}

export interface FeedActionState {
  readonly ok: boolean;
  readonly code: string | null;
  readonly stamp?: number;
}
