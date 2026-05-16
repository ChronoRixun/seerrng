import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

export type ThemePalette = {
  id: string;
  name: string;
  swatches: string[];
};

export const themePalettes: ThemePalette[] = [
  { id: 'aurora', name: 'Aurora', swatches: ['#4f46e5', '#a855f7', '#14b8a6'] },
  { id: 'ember', name: 'Ember', swatches: ['#dc2626', '#f97316', '#f59e0b'] },
  { id: 'lagoon', name: 'Lagoon', swatches: ['#0f766e', '#0891b2', '#2563eb'] },
  { id: 'orchid', name: 'Orchid', swatches: ['#7c3aed', '#d946ef', '#ec4899'] },
  { id: 'forest', name: 'Forest', swatches: ['#15803d', '#65a30d', '#0f766e'] },
  { id: 'sapphire', name: 'Sapphire', swatches: ['#1d4ed8', '#0284c7', '#6366f1'] },
  { id: 'rosewood', name: 'Rosewood', swatches: ['#be123c', '#db2777', '#7c2d12'] },
  { id: 'citrus', name: 'Citrus', swatches: ['#ca8a04', '#84cc16', '#f97316'] },
  { id: 'arctic', name: 'Arctic', swatches: ['#0284c7', '#64748b', '#22d3ee'] },
  { id: 'grape', name: 'Grape', swatches: ['#6d28d9', '#9333ea', '#4f46e5'] },
  { id: 'coral', name: 'Coral', swatches: ['#e11d48', '#fb7185', '#f97316'] },
  { id: 'mint', name: 'Mint', swatches: ['#059669', '#10b981', '#06b6d4'] },
  { id: 'steel', name: 'Steel', swatches: ['#475569', '#2563eb', '#0f766e'] },
  { id: 'gold', name: 'Gold', swatches: ['#b45309', '#eab308', '#ea580c'] },
  { id: 'plum', name: 'Plum', swatches: ['#86198f', '#be185d', '#7c3aed'] },
  { id: 'skyline', name: 'Skyline', swatches: ['#0369a1', '#4f46e5', '#06b6d4'] },
  { id: 'moss', name: 'Moss', swatches: ['#4d7c0f', '#16a34a', '#ca8a04'] },
  { id: 'flame', name: 'Flame', swatches: ['#c2410c', '#dc2626', '#f59e0b'] },
  { id: 'violet', name: 'Violet', swatches: ['#5b21b6', '#7e22ce', '#2563eb'] },
  { id: 'ocean', name: 'Ocean', swatches: ['#075985', '#0d9488', '#1d4ed8'] },
];

type ThemeContextValue = {
  mode: ThemeMode;
  palette: string;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: string) => void;
  toggleMode: () => void;
};

const THEME_MODE_KEY = 'seerr-theme-mode';
const THEME_PALETTE_KEY = 'seerr-theme-palette';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getStoredMode = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedMode = window.localStorage.getItem(THEME_MODE_KEY);
  return storedMode === 'light' || storedMode === 'dark' ? storedMode : 'dark';
};

const getStoredPalette = (): string => {
  if (typeof window === 'undefined') {
    return themePalettes[0].id;
  }

  const storedPalette = window.localStorage.getItem(THEME_PALETTE_KEY);
  return storedPalette &&
    themePalettes.some((palette) => palette.id === storedPalette)
    ? storedPalette
    : themePalettes[0].id;
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [palette, setPaletteState] = useState(themePalettes[0].id);

  useEffect(() => {
    setModeState(getStoredMode());
    setPaletteState(getStoredPalette());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.themePalette = palette;
    document.documentElement.classList.toggle('dark', mode === 'dark');
    window.localStorage.setItem(THEME_MODE_KEY, mode);
    window.localStorage.setItem(THEME_PALETTE_KEY, palette);
  }, [mode, palette]);

  const value = useMemo(
    () => ({
      mode,
      palette,
      setMode: setModeState,
      setPalette: setPaletteState,
      toggleMode: () =>
        setModeState((currentMode) =>
          currentMode === 'dark' ? 'light' : 'dark'
        ),
    }),
    [mode, palette]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const themeContext = useContext(ThemeContext);

  if (!themeContext) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return themeContext;
};
