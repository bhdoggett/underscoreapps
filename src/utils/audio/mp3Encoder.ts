function toInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-1, Math.min(1, float32[i])) * 0x7fff
  }
  return int16
}

export async function encodeMP3(buffer: AudioBuffer): Promise<Blob> {
  const { Mp3Encoder } = await import('lamejs/lame.min.js')
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitrate = 128
  const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate)
  const blockSize = 1152
  const mp3Data: Uint8Array[] = []

  const left = toInt16(buffer.getChannelData(0))
  const right = numChannels > 1 ? toInt16(buffer.getChannelData(1)) : left

  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize)
    const r = right.subarray(i, i + blockSize)
    const chunk = numChannels > 1
      ? encoder.encodeBuffer(l, r)
      : encoder.encodeBuffer(l)
    if (chunk.length) mp3Data.push(new Uint8Array(chunk as unknown as Uint8Array))
  }

  const final = encoder.flush()
  if (final.length) mp3Data.push(new Uint8Array(final as unknown as Uint8Array))

  return new Blob(mp3Data as BlobPart[], { type: 'audio/mp3' })
}
