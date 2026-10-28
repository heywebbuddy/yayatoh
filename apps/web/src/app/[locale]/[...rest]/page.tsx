import { notFound } from 'next/navigation';

/**
 * Any address nothing else answers: the locale's own designed 404 (not-found.tsx), in the visitor's
 * theme, instead of the framework's bare page.
 */
export default function NoSuchPage(): never {
  notFound();
}
