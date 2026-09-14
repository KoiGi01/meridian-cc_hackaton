/**
 * Drift detection (BUILD-SPEC 5.7): the state and the words.
 *
 * A *quest* is what the user asked for. It outlives the light: after a
 * correction the light is off and the goal is pending, waiting for the user to
 * come back; while pending, the agent may light a global element (a sidebar
 * link) as a *waypoint* — that does not start a new quest. Everything here is
 * pure so the tone rule ("correct once, briefly; after two ignored
 * corrections offer to start over") is a unit test, not a hope.
 */

/** Corrections spoken before we give up on a goal. */
export const MAX_CORRECTIONS = 2;
/** A pending (unlit) quest is forgotten after this long. */
export const QUEST_TTL_MS = 120_000;

export interface Quest {
  goalId: string;
  /** Route path of the goal, '*' for global elements. */
  goalPath: string;
  corrections: number;
  /** What is lit right now. 'none' = pending, waiting for the user to return. */
  lit: 'goal' | 'waypoint' | 'none';
  pendingSince: number | null;
}

export type LitRole = 'goal' | 'waypoint';

export class DriftTracker {
  private q: Quest | null = null;

  get quest(): Quest | null {
    return this.q;
  }

  /**
   * Something was lit. A global element lit while a quest is pending elsewhere
   * is the agent showing the way back: a waypoint. Anything else is a new
   * quest — except relighting the goal itself, which keeps its count so the
   * tone rule cannot be reset by wandering back and forth.
   */
  lit(id: string, path: string, currentPath: string, now: number = Date.now()): LitRole {
    const q = this.live(now);
    if (q) {
      if (id === q.goalId) {
        q.lit = 'goal';
        q.pendingSince = null;
        return 'goal';
      }
      if (q.lit === 'none' && path === '*' && currentPath !== q.goalPath) {
        q.lit = 'waypoint';
        q.pendingSince = null;
        return 'waypoint';
      }
    }
    this.q = { goalId: id, goalPath: path, corrections: 0, lit: 'goal', pendingSince: null };
    return 'goal';
  }

  /** The user clicked the lit element. */
  reached(id: string): 'goal-done' | 'waypoint-done' | 'none' {
    const q = this.q;
    if (!q) return 'none';
    if (q.lit === 'goal' && id === q.goalId) {
      this.q = null;
      return 'goal-done';
    }
    if (q.lit === 'waypoint') {
      q.lit = 'none';
      q.pendingSince = Date.now();
      return 'waypoint-done';
    }
    return 'none';
  }

  /**
   * The user left the goal's screen (drift) or the target vanished (lost).
   * Returns which correction this is; `final` means it is the offer to start
   * over and the quest is gone.
   */
  left(now: number = Date.now()): { attempt: number; final: boolean } | null {
    const q = this.q;
    if (!q) return null;
    q.corrections += 1;
    const attempt = q.corrections;
    if (attempt > MAX_CORRECTIONS) {
      this.q = null;
      return { attempt, final: true };
    }
    q.lit = 'none';
    q.pendingSince = now;
    return { attempt, final: false };
  }

  /** The route changed while the goal was pending. True = relight the goal now. */
  routeChanged(path: string, now: number = Date.now()): boolean {
    const q = this.live(now);
    if (!q || q.lit !== 'none' || path !== q.goalPath) return false;
    // Claimed: the caller lights it and reports back through lit().
    q.lit = 'goal';
    q.pendingSince = null;
    return true;
  }

  reset(): void {
    this.q = null;
  }

  private live(now: number): Quest | null {
    const q = this.q;
    if (q && q.pendingSince !== null && now - q.pendingSince > QUEST_TTL_MS) this.q = null;
    return this.q;
  }
}

export interface CorrectionContext {
  kind: 'drift' | 'lost';
  /** 1 or 2 = correct; 3 = the final offer. */
  attempt: number;
  goal: { id: string; purpose: string | null; screen: string | null; path: string };
  now: { path: string; screen: string | null; visibleIds: string[] };
}

/** "products.add-new-product" → "add new product". A name to say, not an id. */
function spokenName(id: string): string {
  const last = id.split('.').pop() ?? id;
  return last.replace(/-\d+$/, '').replace(/-/g, ' ');
}

const FINAL_OFFER = 'Want me to start over, or should I stop pointing?';

/** Shown in the widget when no voice session is open. */
export function correctionText(ctx: CorrectionContext): string {
  const name = `"${spokenName(ctx.goal.id)}"`;
  const here = ctx.now.screen ?? ctx.now.path;
  const there = ctx.goal.screen ?? ctx.goal.path;
  const body =
    ctx.kind === 'lost'
      ? `I can't see ${name} any more — it was on this screen a moment ago.`
      : `You're on ${here} now. ${name} is on the ${there} screen.`;
  return ctx.attempt > MAX_CORRECTIONS ? `${body} ${FINAL_OFFER}` : body;
}

/** Sent as `reply.create.instructions` when a session is open. */
export function correctionInstruction(ctx: CorrectionContext): string {
  const purpose = ctx.goal.purpose ?? 'no description';
  const goal = `"${ctx.goal.id}" (${purpose}) on screen "${ctx.goal.screen ?? ctx.goal.path}" (path ${ctx.goal.path})`;
  const where =
    ctx.kind === 'lost'
      ? `The user was being pointed at ${goal}, and that control is no longer visible on their screen (still path ${ctx.now.path}).`
      : `The user was being pointed at ${goal}, and just went to path ${ctx.now.path} ("${ctx.now.screen ?? 'unknown screen'}") instead.`;
  const visible = ctx.now.visibleIds.length ? ctx.now.visibleIds.join(', ') : 'none';
  const context = `Visible catalog elements there right now: ${visible}.`;

  if (ctx.attempt > MAX_CORRECTIONS) {
    return [
      where,
      context,
      'You have already corrected them twice. Do not correct again and do not call highlight. In one sentence, offer to start over or to stop pointing, and wait for their answer.',
    ].join(' ');
  }
  return [
    where,
    context,
    'Say ONE short, friendly sentence naming where they are now and where the goal is. Do not scold, do not repeat the greeting.',
    ctx.kind === 'drift'
      ? `If a catalog element on the "Everywhere" screen takes them to "${ctx.goal.screen ?? ctx.goal.path}", call highlight on it so they can see the way back.`
      : 'If the goal is still reachable, call highlight on it again.',
    'Never call navigate: the user chooses where to go.',
  ].join(' ');
}
