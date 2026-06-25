'use client'

interface AxisTrackProps {
  lowLabel: string
  highLabel: string
  value: number
  locked: boolean
  highlighted: boolean
  onChange?: (value: number) => void
}

export function AxisTrack({ lowLabel, highLabel, value, locked, highlighted, onChange }: AxisTrackProps) {
  return (
    <div className="space-y-1.5">
      <div className="relative py-2.5">
        {/* Track bar */}
        <div className="relative h-px rounded-full bg-border">
          {/* Animated dot — moves smoothly via CSS transition (no Framer Motion needed) */}
          <div
            style={{ left: `${value}%` }}
            className={[
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-3.5 rounded-full border-2 border-background shadow-sm',
              'transition-[left] duration-300 ease-out',
              highlighted ? 'bg-primary' : 'bg-foreground',
            ].join(' ')}
          />
        </div>

        {/* Range input overlay — invisible but interactive when unlocked */}
        {!locked && (
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={value}
            onChange={(e) => onChange?.(Number(e.target.value))}
            aria-label={`${lowLabel} to ${highLabel}`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        )}
      </div>

      {/* Pole labels — no numbers (L-6) */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  )
}
