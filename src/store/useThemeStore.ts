import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'chordmaker-theme';

const readInitialTheme = (): Theme =>
  localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';

const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
};

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
}));
