import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { BusinessHours } from './profile-types';

const DAY_LABELS: ReadonlyArray<{ key: keyof BusinessHours; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

export type HoursCardProps = {
  hours: BusinessHours;
};

/** Weekly opening hours; days without periods render as "Closed". */
export function HoursCard({ hours }: HoursCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Hours of Operation</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2">
          {DAY_LABELS.map(({ key, label }) => {
            const periods = hours[key] ?? [];
            const value =
              periods.length === 0
                ? 'Closed'
                : periods.map((period) => `${period.opensAt} – ${period.closesAt}`).join(', ');

            return (
              <div key={key} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-card-foreground/80">{label}</dt>
                <dd className="font-mono text-xs text-card-foreground/80">{value}</dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
