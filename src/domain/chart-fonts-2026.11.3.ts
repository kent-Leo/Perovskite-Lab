export const SONG_FONT_FAMILY = 'Perovskite Lab Song';
export const SONG_FONT_FILE = 'PerovskiteLabSong-Regular-2026.11.3';
export const SERIF_FONT_FAMILY = 'Perovskite Lab Serif';
export const SERIF_FONT_FILE = 'PerovskiteLabSerif-Regular-2026.11.3';

export function chartFontFamily(fontFamily: string): string {
  return fontFamily === SERIF_FONT_FAMILY
    ? `${SERIF_FONT_FAMILY}, ${SONG_FONT_FAMILY}, serif`
    : `${fontFamily}, Perovskite Lab Sans, sans-serif`;
}

export function exportFonts(fontFamily: string) {
  if (fontFamily === SERIF_FONT_FAMILY) return [
    { family: SERIF_FONT_FAMILY, file: SERIF_FONT_FILE },
    { family: SONG_FONT_FAMILY, file: SONG_FONT_FILE },
  ];
  return fontFamily === SONG_FONT_FAMILY
    ? [{ family: SONG_FONT_FAMILY, file: SONG_FONT_FILE }]
    : [{ family: 'Perovskite Lab Sans', file: 'PerovskiteLabSans-Regular' }];
}
