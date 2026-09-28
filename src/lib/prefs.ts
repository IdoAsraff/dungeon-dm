/**
 * App-wide preferences (not tied to a dungeon), stored in the app settings
 * on this Mac: sound effects, music transition, the "General" playlists and
 * the Spotify login.
 */
import { create } from "zustand";
import { backend } from "./backend";

export type Transition = "cut" | "short" | "slow";

export interface PlaylistRef {
  id: string;
  name: string;
  image?: string | null;
}

export interface SpotifyAuth {
  clientId: string;
  refreshToken?: string;
  accessToken?: string;
  /** ms since epoch */
  expiresAt?: number;
}

export interface Prefs {
  sfxEnabled: boolean;
  sfxVolume: number;
  musicTransition: Transition;
  generalPlaylists: PlaylistRef[];
  spotify: SpotifyAuth | null;
}

export const DEFAULT_PREFS: Prefs = {
  sfxEnabled: true,
  sfxVolume: 0.7,
  musicTransition: "short",
  generalPlaylists: [],
  spotify: null,
};

interface PrefsState extends Prefs {
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Prefs>) => void;
}

export const usePrefs = create<PrefsState>()((set) => ({
  ...DEFAULT_PREFS,
  loaded: false,
  load: async () => {
    try {
      const s = (await backend.getSettings()) as unknown as Partial<Prefs>;
      set({
        sfxEnabled: typeof s.sfxEnabled === "boolean" ? s.sfxEnabled : DEFAULT_PREFS.sfxEnabled,
        sfxVolume: typeof s.sfxVolume === "number" ? s.sfxVolume : DEFAULT_PREFS.sfxVolume,
        musicTransition: ["cut", "short", "slow"].includes(s.musicTransition as string) ? (s.musicTransition as Transition) : "short",
        generalPlaylists: Array.isArray(s.generalPlaylists) ? s.generalPlaylists : [],
        spotify: s.spotify && typeof s.spotify.clientId === "string" ? s.spotify : null,
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },
  update: (patch) => {
    set(patch);
    void backend.updateSettings(patch as never).catch((e) => console.error("could not save preferences", e));
  },
}));
