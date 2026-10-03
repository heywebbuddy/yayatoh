// Canary: native date/time inputs outside packages/ui must fail (use DatePicker and friends).
export const Dates = () => (
  <>
    <input type="date" name="a" />
    <input name="b" type="datetime-local" />
    <input type={'time'} name="c" />
  </>
);
