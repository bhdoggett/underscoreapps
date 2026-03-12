import styles from './RangeSlider.module.css'

type Props = {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
}

export default function RangeSlider({ min, max, value, onChange }: Props) {
  return (
    <input
      type="range"
      className={styles.slider}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}
