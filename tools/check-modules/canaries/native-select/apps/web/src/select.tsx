// Canary: a native select element outside packages/ui must fail (use Select from @yayatoh/ui).
export const Native = () => (
  <select name="status">
    <option value="a">{'a'}</option>
  </select>
);
