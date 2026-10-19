/** Display-only month week: 1–7 = first, 8–14 = second, etc. No timezone conversion. */
export function sermonWeekLabel(sermonDate: string): string {
  const month = Number(sermonDate.slice(5, 7));
  const week = Math.ceil(Number(sermonDate.slice(8, 10)) / 7);
  const ordinal = ["첫째", "둘째", "셋째", "넷째", "다섯째"][week - 1];
  return `${month}월 ${ordinal} 주`;
}
