import { useLocaleStore } from '../store/useLocaleStore';

export interface Localized {
  ja: string;
  en: string;
}

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  const t = (entry: Localized): string => entry[locale];
  return { locale, t };
}
