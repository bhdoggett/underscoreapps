const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export interface EngineTrack {
  id: string
  buffer: AudioBuffer
  startOffset: number   // seconds from timeline start; negative = starts before t=0
  trimStart: number     // seconds to skip at buffer start
  trimEnd: number       // seconds to skip at buffer end
  volume: number        // 0–1
  pan: number           // -1 to +1
  muted: boolean
}

export class AudioPlusEngine {
  private ctx: AudioContext | null = null
  private sources: Map<string, AudioBufferSourceNode> = new Map()
  private gains: Map<string, GainNode> = new Map()
  private panners: Map<string, StereoPannerNode> = new Map()
  private clickTimer: ReturnType<typeof setTimeout> | null = null
  private countInTimer: ReturnType<typeof setTimeout> | null = null
  private nextClickTime = 0
  private currentBeat = 0
  private beatsPerMeasure = 4
  private mediaRecorder: MediaRecorder | null = null
  private mediaStream: MediaStream | null = null
  private recordingChunks: Blob[] = []
  private rafId: number | null = null

  getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  /** Estimated output latency in ms from browser APIs. */
  getLatencyMs(): number {
    const ctx = this.getCtx()
    return (ctx.outputLatency + ctx.baseLatency) * 1000
  }

  /**
   * Start playing tracks + optional click. Returns AudioContext time playback begins.
   * onTick is called each animation frame with elapsed seconds since playback started.
   */
  play(
    tracks: EngineTrack[],
    bpm: number,
    beatsPerMeasure: number,
    metronomeOn: boolean,
    onTick: (elapsedSeconds: number) => void
  ): number {
    const ctx = this.getCtx()
    if (ctx.state === 'suspended') ctx.resume()
    this.stop()

    this.beatsPerMeasure = beatsPerMeasure

    const masterGain = ctx.createGain()
    masterGain.connect(ctx.destination)

    const startAt = ctx.currentTime + 0.05

    for (const track of tracks) {
      if (track.muted) continue
      const duration = track.buffer.duration - track.trimStart - track.trimEnd
      if (duration <= 0) continue

      const source = ctx.createBufferSource()
      source.buffer = track.buffer

      const gain = ctx.createGain()
      gain.gain.value = track.volume

      const panner = ctx.createStereoPanner()
      panner.pan.value = track.pan

      source.connect(gain)
      gain.connect(panner)
      panner.connect(masterGain)

      this.gains.set(track.id, gain)
      this.panners.set(track.id, panner)

      // Negative startOffset: track started before t=0, skip into buffer
      const when = startAt + Math.max(0, track.startOffset)
      const bufferOffset = track.trimStart + Math.max(0, -track.startOffset)
      const playDuration = duration - Math.max(0, -track.startOffset)
      if (playDuration <= 0) continue

      source.start(when, bufferOffset, playDuration)
      this.sources.set(track.id, source)
    }

    if (metronomeOn) {
      this.currentBeat = 0
      this.nextClickTime = startAt
      this.scheduleClicks(bpm)
    }

    const tick = () => {
      onTick(ctx.currentTime - startAt)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)

    return startAt
  }

  /** Start or stop the metronome click without affecting playback. */
  setMetronome(on: boolean, bpm: number, beatsPerMeasure: number) {
    this.beatsPerMeasure = beatsPerMeasure
    if (on) {
      if (this.clickTimer === null) {
        const ctx = this.getCtx()
        this.currentBeat = 0
        this.nextClickTime = ctx.currentTime + 0.05
        this.scheduleClicks(bpm)
      }
    } else {
      if (this.clickTimer !== null) {
        clearTimeout(this.clickTimer)
        this.clickTimer = null
      }
    }
  }

  setTrackVolume(id: string, volume: number) {
    const gain = this.gains.get(id)
    if (gain) gain.gain.value = volume
  }

  setTrackPan(id: string, pan: number) {
    const panner = this.panners.get(id)
    if (panner) panner.pan.value = pan
  }

  stop() {
    this.sources.forEach(s => { try { s.stop() } catch { /* already stopped */ } })
    this.sources.clear()
    this.gains.clear()
    this.panners.clear()
    if (this.clickTimer !== null) { clearTimeout(this.clickTimer); this.clickTimer = null }
    if (this.countInTimer !== null) { clearTimeout(this.countInTimer); this.countInTimer = null }
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null }
  }

  destroy() {
    this.stop()
    this.ctx?.close()
    this.ctx = null
  }

  private scheduleClicks(bpm: number) {
    if (!this.ctx) return
    const ctx = this.getCtx()
    while (this.nextClickTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.playClick(this.nextClickTime, this.currentBeat % this.beatsPerMeasure === 0)
      this.nextClickTime += 60 / bpm
      this.currentBeat++
    }
    this.clickTimer = setTimeout(() => this.scheduleClicks(bpm), LOOKAHEAD_MS)
  }

  private playClick(time: number, isDownbeat: boolean) {
    const ctx = this.getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = isDownbeat ? 1000 : 800
    gain.gain.setValueAtTime(0.001, time)
    gain.gain.exponentialRampToValueAtTime(0.4, time + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06)
    osc.start(time)
    osc.stop(time + 0.07)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }

  /**
   * Start recording with a one-measure count-in click before backing tracks begin.
   * Metronome click plays through the count-in always; continues after if metronomeOn.
   * Returns estimated round-trip latency (output + input) in ms.
   */
  async startRecording(
    tracks: EngineTrack[],
    bpm: number,
    beatsPerMeasure: number,
    metronomeOn: boolean,
    onTick: (elapsedSeconds: number) => void
  ): Promise<{ latencyMs: number }> {
    // Disable echo cancellation so the browser doesn't process out backing tracks.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    this.mediaStream = stream
    this.beatsPerMeasure = beatsPerMeasure

    const ctx = this.getCtx()
    if (ctx.state === 'suspended') ctx.resume()

    // Combine output latency with input latency reported by the mic track.
    const trackSettings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }
    const inputLatencyMs = (trackSettings?.latency ?? 0) * 1000
    const latencyMs = (ctx.outputLatency + ctx.baseLatency) * 1000 + inputLatencyMs

    const countInDuration = beatsPerMeasure * (60 / bpm)
    const countInStartAt = ctx.currentTime + 0.05
    const tracksStartAt = countInStartAt + countInDuration

    // Count-in click (always plays for one measure regardless of metronomeOn)
    this.currentBeat = 0
    this.nextClickTime = countInStartAt
    this.scheduleClicks(bpm)

    // If metronome is off, stop click after count-in completes
    if (!metronomeOn) {
      this.countInTimer = setTimeout(() => {
        this.countInTimer = null
        if (this.clickTimer !== null) { clearTimeout(this.clickTimer); this.clickTimer = null }
      }, countInDuration * 1000)
    }

    // Schedule backing tracks to start after count-in
    const masterGain = ctx.createGain()
    masterGain.connect(ctx.destination)

    for (const track of tracks) {
      if (track.muted) continue
      const duration = track.buffer.duration - track.trimStart - track.trimEnd
      if (duration <= 0) continue

      const source = ctx.createBufferSource()
      source.buffer = track.buffer

      const gain = ctx.createGain()
      gain.gain.value = track.volume

      const panner = ctx.createStereoPanner()
      panner.pan.value = track.pan

      source.connect(gain)
      gain.connect(panner)
      panner.connect(masterGain)

      this.gains.set(track.id, gain)
      this.panners.set(track.id, panner)

      const when = tracksStartAt + Math.max(0, track.startOffset)
      const bufferOffset = track.trimStart + Math.max(0, -track.startOffset)
      const playDuration = duration - Math.max(0, -track.startOffset)
      if (playDuration <= 0) continue

      source.start(when, bufferOffset, playDuration)
      this.sources.set(track.id, source)
    }

    // RAF: negative elapsed during count-in, 0+ once backing tracks begin
    const tick = () => {
      onTick(ctx.currentTime - tracksStartAt)
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)

    // Route mic through the Web Audio graph to avoid OS-level echo cancellation
    // suppressing backing tracks from the mic signal.
    const micSource = ctx.createMediaStreamSource(stream)
    const micDest = ctx.createMediaStreamDestination()
    micSource.connect(micDest)

    // Start MediaRecorder after count-in
    this.recordingChunks = []
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
    this.mediaRecorder = new MediaRecorder(micDest.stream, { mimeType })
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordingChunks.push(e.data)
    }
    this.countInTimer = setTimeout(() => {
      this.countInTimer = null
      this.mediaRecorder?.start()
    }, countInDuration * 1000)

    return { latencyMs }
  }

  /**
   * Stop recording. Returns raw audio bytes and the latency-corrected startOffset.
   * startOffset is negative: shifts track backward to compensate for round-trip latency.
   */
  stopRecording(latencyOffsetMs: number): Promise<{ audioData: ArrayBuffer; startOffset: number }> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) { reject(new Error('no active recorder')); return }
      const recorder = this.mediaRecorder
      recorder.onstop = async () => {
        const blob = new Blob(this.recordingChunks, { type: recorder.mimeType })
        const audioData = await blob.arrayBuffer()
        resolve({ audioData, startOffset: -(latencyOffsetMs / 1000) })
      }
      recorder.stop()
      this.stop()
      this.mediaStream?.getTracks().forEach(t => t.stop())
      this.mediaStream = null
    })
  }
}
