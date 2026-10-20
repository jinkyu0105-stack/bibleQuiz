export type SaveMode = "auto" | "manual";
export type SavePart = {
  signature: string | null;
  enabled: boolean;
  scope: "server" | "browser";
  save: () => Promise<boolean>;
};
export type SaveState = {
  dirty: boolean;
  saving: boolean;
  message: string;
  tone: "idle" | "success" | "error";
};

// Allow React to commit the refreshed version before another editor writes.
const committed = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** One queue for the existing version-checked writers and the visible save controls. */
export class WorkflowSave {
  private parts = new Map<string, SavePart>();
  private listeners = new Set<() => void>();
  private tail: Promise<boolean> = Promise.resolve(true);
  private state: SaveState = { dirty: false, saving: false, message: "변경하면 자동 저장됩니다.", tone: "idle" };
  private pending = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(patch: Partial<SaveState> = {}) {
    const next = { ...this.state, dirty: [...this.parts.values()].some(part => part.signature !== null), ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  set(id: string, part: SavePart) { this.parts.set(id, part); this.update(); }
  remove(id: string) { this.parts.delete(id); this.update(); }
  announce(message: string) { this.update({ tone: "idle", message }); }
  saveOne = (id: string, mode: SaveMode): Promise<boolean> => {
    this.pending++;
    const operation = this.tail.then(async () => {
      const part = this.parts.get(id);
      if (!part?.signature) return true;
      if (!part.enabled) {
        if (mode === "manual") this.update({ tone: "error", message: "진행 중인 처리가 끝난 뒤 다시 저장해 주세요." });
        return false;
      }
      this.update({ saving: true, tone: "idle", message: "변경 내용을 저장하고 있습니다." });
      try {
        if (!await part.save()) {
          this.update({ tone: "error", message: "저장하지 못했습니다. 입력 내용과 아래 안내를 확인해 주세요." });
          return false;
        }
        await committed();
        const time = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(new Date());
        this.update({ tone: "success", message: `${time} ${part.scope === "browser" ? "이 브라우저에 " : ""}${mode === "auto" ? "자동" : "임시"} 저장했습니다.` });
        return true;
      } catch (error) {
        this.update({ tone: "error", message: error instanceof Error ? error.message : "저장하지 못했습니다. 다시 시도해 주세요." });
        return false;
      } finally {
        await committed();
      }
    }).finally(() => {
      this.pending--;
      this.update({ saving: this.pending > 0 });
    });
    this.tail = operation;
    return operation;
  };
  saveAll = async () => {
    await this.tail;
    await committed();
    const ids = [...this.parts].filter(([, part]) => part.signature !== null).map(([id]) => id);
    for (const id of ids) if (!await this.saveOne(id, "manual")) return false;
    await committed();
    if (this.getSnapshot().dirty) {
      this.update({ tone: "error", message: "아직 저장할 변경이 남아 있습니다. 임시 저장을 다시 눌러 주세요." });
      return false;
    }
    if (!ids.length && this.state.tone !== "success") this.update({ tone: "idle", message: "새로 저장할 변경이 없습니다." });
    return true;
  };
}
