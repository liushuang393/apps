/**
 * 受聴者単位 Media QoE（backend QoEStateMachine の LISTENER_LOCAL と同等の政策）。
 *
 * 個人の packet loss だけを見て翻訳音声のローカル mute / 回復を決める。
 * 会議全体の Mode A は止めない。ヒステリシスと cooldown はここに集約する。
 */

/** backend `LOSS_DEGRADE_RATIO` と一致させる */
export const LOSS_DEGRADE_RATIO = 0.05;
/** backend `LOSS_RECOVER_RATIO` と一致させる */
export const LOSS_RECOVER_RATIO = 0.03;
/** backend `DEFAULT_RECOVERY_COOLDOWN_S`（秒）×1000 */
export const RECOVERY_COOLDOWN_MS = 5000;

export type ListenerLocalUiReason = 'healthy' | 'degraded' | 'recovered';

export interface ListenerLocalDecision {
  hearingAvailable: boolean;
  changed: boolean;
  uiReason: ListenerLocalUiReason;
}

/**
 * 受聴者単位の Media 劣化・回復を決定する。
 * 時計を注入でき、フラッピング防止の cooldown を決定論的に検証できる。
 */
export class ListenerLocalQoE {
  private degraded = false;
  private healthySince: number | null = null;

  constructor(
    private readonly cooldownMs: number = RECOVERY_COOLDOWN_MS,
    private readonly now: () => number = () => Date.now()
  ) {}

  evaluate(packetLossRatio: number | null): ListenerLocalDecision {
    const previous = this.degraded;
    const active = this.isMediaDegraded(packetLossRatio);
    const now = this.now();

    if (!active && this.degraded) {
      if (this.healthySince === null) {
        this.healthySince = now;
      }
      if (now - this.healthySince < this.cooldownMs) {
        return {
          hearingAvailable: false,
          changed: false,
          uiReason: 'degraded',
        };
      }
      this.degraded = false;
      this.healthySince = null;
    } else if (active) {
      this.degraded = true;
      this.healthySince = null;
    } else {
      this.healthySince = null;
    }

    const changed = this.degraded !== previous;
    if (!this.degraded) {
      return {
        hearingAvailable: true,
        changed,
        uiReason: changed ? 'recovered' : 'healthy',
      };
    }
    return {
      hearingAvailable: false,
      changed,
      uiReason: 'degraded',
    };
  }

  private isMediaDegraded(packetLossRatio: number | null): boolean {
    if (packetLossRatio === null) {
      return false;
    }
    const threshold = this.degraded ? LOSS_RECOVER_RATIO : LOSS_DEGRADE_RATIO;
    return packetLossRatio > threshold;
  }
}
