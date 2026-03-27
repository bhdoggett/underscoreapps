import styles from './RangeSlider.module.css'

type Props = {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  step?: number
  vertical?: boolean
  size?: number
  className?: string
}

export default function RangeSlider({ min, max, value, onChange, step, vertical, size, className }: Props) {
  return (
    <input
      type="range"
      className={[vertical ? styles.vertical : styles.slider, className].filter(Boolean).join(' ')}
      style={vertical && size ? { height: size } : undefined}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}
