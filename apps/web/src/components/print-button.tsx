'use client';

import { Button } from '@yayatoh/ui';
import { Printer } from 'lucide-react';

/** Opens the browser's print dialog (the poster's print CSS takes it from there). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
