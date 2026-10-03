import { useEffect, useRef, useState } from "react";

import { nextDeadlineRefresh, remainingTimeLabel } from "./deadline";

export function QuizDeadline({ closesAt, closesAtLabel, refreshOnExpiry = false, onExpire }: {
  closesAt: string;
  closesAtLabel: string;
  refreshOnExpiry?: boolean;
  onExpire?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const expirationReported = useRef(false);
  const remaining = remainingTimeLabel(closesAt, now);

  useEffect(() => {
    expirationReported.current = false;
    let timer: number | undefined;

    const refresh = () => {
      const current = Date.now();
      setNow(current);
      const delay = nextDeadlineRefresh(closesAt, current);
      if (delay !== null) timer = window.setTimeout(refresh, delay);
    };

    refresh();
    return () => window.clearTimeout(timer);
  }, [closesAt]);

  useEffect(() => {
    if (!refreshOnExpiry || remaining !== "마감되었습니다." || expirationReported.current) return;
    expirationReported.current = true;
    onExpire?.();
  }, [onExpire, refreshOnExpiry, remaining]);

  return <>
    <span>참여 마감: </span><time dateTime={closesAt}>{closesAtLabel}</time>
    <span className="remaining-time" data-testid="remaining-time" aria-live="polite">남은 기간: {remaining}</span>
  </>;
}
