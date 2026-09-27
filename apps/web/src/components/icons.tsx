import {
  Armchair,
  Bell,
  Calendar,
  CalendarCheck,
  ChartLine,
  ClipboardList,
  Globe,
  Heart,
  House,
  Image,
  Landmark,
  Library,
  ListChecks,
  type LucideIcon,
  MailCheck,
  Megaphone,
  MessageSquare,
  Palette,
  ScanLine,
  Search,
  Settings,
  Store,
  Ticket,
  Users,
} from 'lucide-react';

/** Icon names used by the profiles registry (packages/platform/src/profiles). */
const ICONS: Record<string, LucideIcon> = {
  home: House,
  chart: ChartLine,
  'list-checks': ListChecks,
  palette: Palette,
  users: Users,
  ticket: Ticket,
  armchair: Armchair,
  megaphone: Megaphone,
  scan: ScanLine,
  library: Library,
  clipboard: ClipboardList,
  calendar: Calendar,
  store: Store,
  heart: Heart,
  message: MessageSquare,
  'mail-check': MailCheck,
  search: Search,
  globe: Globe,
  image: Image,
  'calendar-check': CalendarCheck,
  bell: Bell,
  settings: Settings,
  landmark: Landmark,
};

export function Icon({ name, className = 'size-4' }: { name: string; className?: string }) {
  const C = ICONS[name] ?? House;
  return <C aria-hidden="true" className={className} strokeWidth={1.6} />;
}
