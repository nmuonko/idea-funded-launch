import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarIcon } from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

export type DateRange = {
  from: Date;
  to: Date;
};

export type PresetRange = 'today' | '7days' | '30days' | '90days' | 'custom';

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
}

const presets: { value: PresetRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: '90days', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom Range' },
];

export function getDateRangeFromPreset(preset: PresetRange): DateRange {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) };
    case '7days':
      return { from: startOfDay(subDays(now, 7)), to: endOfDay(now) };
    case '30days':
      return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    case '90days':
      return { from: startOfDay(subDays(now, 90)), to: endOfDay(now) };
    default:
      return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
  }
}

export function DateRangeFilter({ dateRange, onDateRangeChange }: DateRangeFilterProps) {
  const [selectedPreset, setSelectedPreset] = useState<PresetRange>('30days');
  const [isCustomOpen, setIsCustomOpen] = useState(false);

  const handlePresetChange = (preset: PresetRange) => {
    setSelectedPreset(preset);
    if (preset !== 'custom') {
      onDateRangeChange(getDateRangeFromPreset(preset));
      setIsCustomOpen(false);
    } else {
      setIsCustomOpen(true);
    }
  };

  const handleCustomDateSelect = (date: Date | undefined, type: 'from' | 'to') => {
    if (!date) return;
    
    const newRange = {
      ...dateRange,
      [type]: type === 'from' ? startOfDay(date) : endOfDay(date),
    };
    
    // Ensure from is before to
    if (newRange.from > newRange.to) {
      if (type === 'from') {
        newRange.to = endOfDay(date);
      } else {
        newRange.from = startOfDay(date);
      }
    }
    
    onDateRangeChange(newRange);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select value={selectedPreset} onValueChange={(v) => handlePresetChange(v as PresetRange)}>
        <SelectTrigger className="w-[160px] h-9 text-sm">
          <SelectValue placeholder="Select range" />
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.value} value={preset.value}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedPreset === 'custom' && (
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'justify-start text-left font-normal h-9',
                  !dateRange.from && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? format(dateRange.from, 'MMM d, yyyy') : 'From'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.from}
                onSelect={(date) => handleCustomDateSelect(date, 'from')}
                initialFocus
              />
            </PopoverContent>
          </Popover>

          <span className="text-muted-foreground text-sm">to</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'justify-start text-left font-normal h-9',
                  !dateRange.to && 'text-muted-foreground'
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.to ? format(dateRange.to, 'MMM d, yyyy') : 'To'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateRange.to}
                onSelect={(date) => handleCustomDateSelect(date, 'to')}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d, yyyy')}
      </div>
    </div>
  );
}
