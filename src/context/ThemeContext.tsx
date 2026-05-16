import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

export type ThemePalette = {
  id: string;
  name: string;
  swatches: string[];
  primary: ThemeScaleName;
  secondary: ThemeScaleName;
};

export const themePalettes: ThemePalette[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    swatches: ['#4f46e5', '#a855f7', '#14b8a6'],
    primary: 'indigo',
    secondary: 'purple',
  },
  {
    id: 'ember',
    name: 'Ember',
    swatches: ['#dc2626', '#f97316', '#f59e0b'],
    primary: 'red',
    secondary: 'orange',
  },
  {
    id: 'lagoon',
    name: 'Lagoon',
    swatches: ['#0f766e', '#0891b2', '#2563eb'],
    primary: 'teal',
    secondary: 'cyan',
  },
  {
    id: 'orchid',
    name: 'Orchid',
    swatches: ['#7c3aed', '#d946ef', '#ec4899'],
    primary: 'violet',
    secondary: 'fuchsia',
  },
  {
    id: 'forest',
    name: 'Forest',
    swatches: ['#15803d', '#65a30d', '#0f766e'],
    primary: 'green',
    secondary: 'lime',
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    swatches: ['#1d4ed8', '#0284c7', '#6366f1'],
    primary: 'blue',
    secondary: 'sky',
  },
  {
    id: 'rosewood',
    name: 'Rosewood',
    swatches: ['#be123c', '#db2777', '#7c2d12'],
    primary: 'rose',
    secondary: 'pink',
  },
  {
    id: 'citrus',
    name: 'Citrus',
    swatches: ['#ca8a04', '#84cc16', '#f97316'],
    primary: 'yellow',
    secondary: 'lime',
  },
  {
    id: 'arctic',
    name: 'Arctic',
    swatches: ['#0284c7', '#64748b', '#22d3ee'],
    primary: 'sky',
    secondary: 'slate',
  },
  {
    id: 'grape',
    name: 'Grape',
    swatches: ['#6d28d9', '#9333ea', '#4f46e5'],
    primary: 'purple',
    secondary: 'violet',
  },
  {
    id: 'coral',
    name: 'Coral',
    swatches: ['#e11d48', '#fb7185', '#f97316'],
    primary: 'rose',
    secondary: 'orange',
  },
  {
    id: 'mint',
    name: 'Mint',
    swatches: ['#059669', '#10b981', '#06b6d4'],
    primary: 'emerald',
    secondary: 'teal',
  },
  {
    id: 'steel',
    name: 'Steel',
    swatches: ['#475569', '#2563eb', '#0f766e'],
    primary: 'slate',
    secondary: 'blue',
  },
  {
    id: 'gold',
    name: 'Gold',
    swatches: ['#b45309', '#eab308', '#ea580c'],
    primary: 'amber',
    secondary: 'yellow',
  },
  {
    id: 'plum',
    name: 'Plum',
    swatches: ['#86198f', '#be185d', '#7c3aed'],
    primary: 'fuchsia',
    secondary: 'pink',
  },
  {
    id: 'skyline',
    name: 'Skyline',
    swatches: ['#0369a1', '#4f46e5', '#06b6d4'],
    primary: 'sky',
    secondary: 'indigo',
  },
  {
    id: 'moss',
    name: 'Moss',
    swatches: ['#4d7c0f', '#16a34a', '#ca8a04'],
    primary: 'lime',
    secondary: 'green',
  },
  {
    id: 'flame',
    name: 'Flame',
    swatches: ['#c2410c', '#dc2626', '#f59e0b'],
    primary: 'orange',
    secondary: 'red',
  },
  {
    id: 'violet',
    name: 'Violet',
    swatches: ['#5b21b6', '#7e22ce', '#2563eb'],
    primary: 'violet',
    secondary: 'blue',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatches: ['#075985', '#0d9488', '#1d4ed8'],
    primary: 'cyan',
    secondary: 'blue',
  },
];

const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const themeScales = {
  slate: [
    '248 250 252',
    '241 245 249',
    '226 232 240',
    '203 213 225',
    '148 163 184',
    '100 116 139',
    '71 85 105',
    '51 65 85',
    '30 41 59',
    '15 23 42',
    '2 6 23',
  ],
  red: [
    '254 242 242',
    '254 226 226',
    '254 202 202',
    '252 165 165',
    '248 113 113',
    '239 68 68',
    '220 38 38',
    '185 28 28',
    '153 27 27',
    '127 29 29',
    '69 10 10',
  ],
  orange: [
    '255 247 237',
    '255 237 213',
    '254 215 170',
    '253 186 116',
    '251 146 60',
    '249 115 22',
    '234 88 12',
    '194 65 12',
    '154 52 18',
    '124 45 18',
    '67 20 7',
  ],
  amber: [
    '255 251 235',
    '254 243 199',
    '253 230 138',
    '252 211 77',
    '251 191 36',
    '245 158 11',
    '217 119 6',
    '180 83 9',
    '146 64 14',
    '120 53 15',
    '69 26 3',
  ],
  yellow: [
    '254 252 232',
    '254 249 195',
    '254 240 138',
    '253 224 71',
    '250 204 21',
    '234 179 8',
    '202 138 4',
    '161 98 7',
    '133 77 14',
    '113 63 18',
    '66 32 6',
  ],
  lime: [
    '247 254 231',
    '236 252 203',
    '217 249 157',
    '190 242 100',
    '163 230 53',
    '132 204 22',
    '101 163 13',
    '77 124 15',
    '63 98 18',
    '54 83 20',
    '26 46 5',
  ],
  green: [
    '240 253 244',
    '220 252 231',
    '187 247 208',
    '134 239 172',
    '74 222 128',
    '34 197 94',
    '22 163 74',
    '21 128 61',
    '22 101 52',
    '20 83 45',
    '5 46 22',
  ],
  emerald: [
    '236 253 245',
    '209 250 229',
    '167 243 208',
    '110 231 183',
    '52 211 153',
    '16 185 129',
    '5 150 105',
    '4 120 87',
    '6 95 70',
    '6 78 59',
    '2 44 34',
  ],
  teal: [
    '240 253 250',
    '204 251 241',
    '153 246 228',
    '94 234 212',
    '45 212 191',
    '20 184 166',
    '13 148 136',
    '15 118 110',
    '17 94 89',
    '19 78 74',
    '4 47 46',
  ],
  cyan: [
    '236 254 255',
    '207 250 254',
    '165 243 252',
    '103 232 249',
    '34 211 238',
    '6 182 212',
    '8 145 178',
    '14 116 144',
    '21 94 117',
    '22 78 99',
    '8 51 68',
  ],
  sky: [
    '240 249 255',
    '224 242 254',
    '186 230 253',
    '125 211 252',
    '56 189 248',
    '14 165 233',
    '2 132 199',
    '3 105 161',
    '7 89 133',
    '12 74 110',
    '8 47 73',
  ],
  blue: [
    '239 246 255',
    '219 234 254',
    '191 219 254',
    '147 197 253',
    '96 165 250',
    '59 130 246',
    '37 99 235',
    '29 78 216',
    '30 64 175',
    '30 58 138',
    '23 37 84',
  ],
  indigo: [
    '238 242 255',
    '224 231 255',
    '199 210 254',
    '165 180 252',
    '129 140 248',
    '99 102 241',
    '79 70 229',
    '67 56 202',
    '55 48 163',
    '49 46 129',
    '30 27 75',
  ],
  violet: [
    '245 243 255',
    '237 233 254',
    '221 214 254',
    '196 181 253',
    '167 139 250',
    '139 92 246',
    '124 58 237',
    '109 40 217',
    '91 33 182',
    '76 29 149',
    '46 16 101',
  ],
  purple: [
    '250 245 255',
    '243 232 255',
    '233 213 255',
    '216 180 254',
    '192 132 252',
    '168 85 247',
    '147 51 234',
    '126 34 206',
    '107 33 168',
    '88 28 135',
    '59 7 100',
  ],
  fuchsia: [
    '253 244 255',
    '250 232 255',
    '245 208 254',
    '240 171 252',
    '232 121 249',
    '217 70 239',
    '192 38 211',
    '162 28 175',
    '134 25 143',
    '112 26 117',
    '74 4 78',
  ],
  pink: [
    '253 242 248',
    '252 231 243',
    '251 207 232',
    '249 168 212',
    '244 114 182',
    '236 72 153',
    '219 39 119',
    '190 24 93',
    '157 23 77',
    '131 24 67',
    '80 7 36',
  ],
  rose: [
    '255 241 242',
    '255 228 230',
    '254 205 211',
    '253 164 175',
    '251 113 133',
    '244 63 94',
    '225 29 72',
    '190 18 60',
    '159 18 57',
    '136 19 55',
    '76 5 25',
  ],
} as const;

type ThemeScaleName = keyof typeof themeScales;

const applyScale = (
  root: HTMLElement,
  target: 'indigo' | 'purple',
  scale: readonly string[]
) => {
  shades.forEach((shade, index) => {
    root.style.setProperty(`--color-${target}-${shade}`, scale[index]);
  });
};

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
    const activePalette =
      themePalettes.find((themePalette) => themePalette.id === palette) ??
      themePalettes[0];

    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.themePalette = palette;
    document.documentElement.classList.toggle('dark', mode === 'dark');
    applyScale(
      document.documentElement,
      'indigo',
      themeScales[activePalette.primary]
    );
    applyScale(
      document.documentElement,
      'purple',
      themeScales[activePalette.secondary]
    );
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
