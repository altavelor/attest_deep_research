export class Notice {
  isHidden = false;

  constructor(public message: string) {
    shownNotices.push(this);
  }

  setMessage(message: string): this {
    this.message = message;
    return this;
  }

  hide(): void {
    this.isHidden = true;
  }
}

const shownNotices: Notice[] = [];

/** Notices raised since the last reset, so tests can assert user-facing messages. */
export function takeNotices(): Notice[] {
  return shownNotices.splice(0, shownNotices.length);
}
