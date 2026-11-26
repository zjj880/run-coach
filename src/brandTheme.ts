import { Platform } from 'react-native';

export const displayFont = Platform.select({
  web: 'JiaowopaoSong, "Noto Serif SC", "Songti SC", SimSun, serif',
  default: 'JiaowopaoSong',
});

export const brandTheme = {
  accent: '#A83B2D',
  wash: '#304A60',
  ink: '#243747',
  muted: '#535F65',
  paper: '#F7F1E8',
  border: '#DED3C5',
  tint: '#F5E4DB',
  soft: '#EDEFEF',
  controlBorder: '#D5C5B5',
  selectedBorder: '#B76C5F',
  bodyInk: '#3C4C55',
  hint: '#62645F',
  scrim: '#24374780',
  onWash: '#F4F1EB',
  onWashAccent: '#FFE2D2',
  washDivider: '#F4F1EB59',
} as const;
