import { create } from 'zustand';

export type Locale = 'ja' | 'en';

const STORAGE_KEY = 'chordmaker-locale';

const readInitialLocale = (): Locale =>
  localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ja';

interface LocaleState {
  locale: Locale;
  toggleLocale: () => void;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: readInitialLocale(),
  toggleLocale: () => {
    const next: Locale = get().locale === 'ja' ? 'en' : 'ja';
    document.documentElement.lang = next;
    localStorage.setItem(STORAGE_KEY, next);
    set({ locale: next });
  },
}));
