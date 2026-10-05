'use client';

import { Button } from '@yayatoh/ui';
import { Printer } from 'lucide-react';

/** Print the sheet of table cards (the browser's own dialog; the page hides its chrome when printed). */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer aria-hidden="true" className="size-4" />
      {label}
    </Button>
  );
}
