// Canary: literal UI text must fail (use next-intl messages).
export default function Page() {
  return (
    <main>
      <h1>Welcome back</h1>
      <input aria-label="Search events" />
    </main>
  );
}
