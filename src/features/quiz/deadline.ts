export function remainingTimeLabel(deadline: string | number | Date, now: string | number | Date = Date.now()): string {
  const remainingMs = new Date(deadline).getTime() - new Date(now).getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "마감되었습니다.";

  const totalMinutes = Math.max(1, Math.floor(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

export function nextDeadlineRefresh(deadline: string | number | Date, now = Date.now()): number | null {
  const remainingMs = new Date(deadline).getTime() - now;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;

  const untilNextMinute = 60_000 - (now % 60_000) + 25;
  return Math.max(25, Math.min(remainingMs, untilNextMinute));
}
