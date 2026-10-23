import { levelOf } from '@/engine/audio/onset'

/** An open microphone: stopping it lets go of it altogether. */
export interface Microphone {
  stop(): void
}

/**
 * Opens the microphone and calls `onLevel` with its loudness, in dBFS, and the seconds since the
 * last, about every 20 ms. The sound is measured and dropped there: nothing is kept or sent.
 * Rejects when the player says no or there is no microphone.
 */
export type OpenMicrophone = (onLevel: (db: number, dt: number) => void) => Promise<Microphone>

/** How often the level is read, in milliseconds. */
const EVERY = 20

export const openMicrophone: OpenMicrophone = async (onLevel) => {
  // Left raw, so a clap is not smoothed away or a voice turned up
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  })
  const context = new AudioContext()
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  let last = performance.now()
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    const now = performance.now()
    onLevel(levelOf(samples), (now - last) / 1000)
    last = now
  }, EVERY)
  return {
    stop() {
      clearInterval(timer)
      source.disconnect()
      for (const track of stream.getTracks()) track.stop()
      void context.close()
    },
  }
}
