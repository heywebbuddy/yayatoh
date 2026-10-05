'use client';

import { Button, iconButtonClass, Menu, Modal, Sheet, ToastProvider, Tooltip, useToast } from '@yayatoh/ui';
import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { S } from './specimens.ts';

function Inner() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const toast = useToast();
  const o = S.overlays;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Menu
        label={o.menu}
        trigger={<MoreHorizontal aria-hidden="true" strokeWidth={2} />}
        triggerClassName={iconButtonClass('secondary')}
        align="start"
        items={o.items.map((label, i) => ({ key: label, label, danger: i === 2, onSelect: () => undefined }))}
      />
      <Button variant="secondary" onClick={() => setModal(true)}>
        {o.openModal}
      </Button>
      <Button variant="secondary" onClick={() => setSheet(true)}>
        {o.openSheet}
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ title: o.toastTitle, action: { label: o.undo, onSelect: () => undefined } })}
      >
        {o.toast}
      </Button>
      <Tooltip label={o.tooltip}>
        <Button variant="ghost">{o.tooltipTrigger}</Button>
      </Tooltip>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={o.modalTitle}
        description={o.modalBody}
        closeLabel={o.close}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              {o.cancel}
            </Button>
            <Button variant="danger" onClick={() => setModal(false)}>
              {o.confirm}
            </Button>
          </>
        }
      />
      <Sheet open={sheet} onClose={() => setSheet(false)} title={o.sheetTitle} closeLabel={o.close}>
        <p className="m-0 text-body text-ink-2">{S.empty.description}</p>
      </Sheet>
    </div>
  );
}

/** Menu, Modal, Sheet, Toast and Tooltip, live (keyboard: Tab, Enter, arrows, Esc). */
export function OverlayDemo() {
  return (
    <ToastProvider closeLabel={S.overlays.close}>
      <Inner />
    </ToastProvider>
  );
}
