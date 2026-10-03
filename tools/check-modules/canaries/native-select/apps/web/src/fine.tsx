// Canary: the UI kit's components, a "select" in prose and a datetime-local kind string pass.
import { DateTimePicker, Select } from '@yayatoh/ui';

const kind = 'datetime-local';
export const Fine = () => (
  <>
    <Select name="status" />
    <DateTimePicker name="at" />
    <input type="text" name="q" data-kind={kind} />
  </>
);
