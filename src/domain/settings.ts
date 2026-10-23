/** The player's choices about the app itself. */
export interface Settings {
  /** «Escuchar» is on: the puppies react to sounds through the microphone. */
  listen: boolean
  /** The player has read what is done with the sound, and agreed to it. */
  explained: boolean
}

export const DEFAULT_SETTINGS: Settings = { listen: false, explained: false }
