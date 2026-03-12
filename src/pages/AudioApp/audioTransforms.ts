export function transformReverse(buf: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const input = buf.getChannelData(c)
    const output = out.getChannelData(c)
    for (let i = 0; i < buf.length; i++) output[i] = input[buf.length - 1 - i]
  }
  return out
}

export function transformSpeed(buf: AudioBuffer, factor: number): AudioBuffer {
  const newLength = Math.round(buf.length / factor)
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: newLength, sampleRate: buf.sampleRate })
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const input = buf.getChannelData(c)
    const output = out.getChannelData(c)
    for (let i = 0; i < newLength; i++) {
      const pos = i * factor
      const idx = Math.floor(pos)
      const frac = pos - idx
      output[i] = idx + 1 < input.length
        ? input[idx] * (1 - frac) + input[idx + 1] * frac
        : input[Math.min(idx, input.length - 1)]
    }
  }
  return out
}

export function transformMono(buf: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: 1, length: buf.length, sampleRate: buf.sampleRate })
  const output = out.getChannelData(0)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const input = buf.getChannelData(c)
    for (let i = 0; i < buf.length; i++) output[i] += input[i] / buf.numberOfChannels
  }
  return out
}

export function trimBuffer(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sampleRate = buffer.sampleRate
  const startSample = Math.round(startSec * sampleRate)
  const endSample = Math.round(endSec * sampleRate)
  const length = endSample - startSample
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length, sampleRate })
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(buffer.getChannelData(ch).slice(startSample, endSample), ch)
  }
  return out
}

export function transformNormalize(buf: AudioBuffer): AudioBuffer {
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  }
  if (peak === 0 || peak >= 1) return buf
  const gain = 1 / peak
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const input = buf.getChannelData(c)
    const output = out.getChannelData(c)
    for (let i = 0; i < buf.length; i++) output[i] = input[i] * gain
  }
  return out
}
