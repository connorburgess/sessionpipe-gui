// SPDX-License-Identifier: Apache-2.0
// Owned by: web. In-app toasts: the list the stack (components/Toasts.tsx) renders, and
// the rules of the list. A toast for an open attention stays until it is acted on,
// dismissed or the attention clears; the rest leave after TOAST_MS. Never more than
// TOAST_MAX: the oldest leaving-by-itself one goes first. Each toast plays the sound of
// its moment (lib/sounds.ts) once, when it arrives. Control messages this page sent are
// remembered here so their `delivered` never toasts back at the person who sent them.
import type { SessionKey } from "@shared/api";
import { useSyncExternalStore } from "react";
import { playSound, type SoundKind } from "./sounds";

export const TOAST_MS = 8000;
export const TOAST_MAX = 3;

export type ToastKind = "needs-you" | "error" | "delivered";

export interface Toast {
  id: string;
  kind: ToastKind;
  /** Stays until acted on or dismissed (an open attention); else leaves after TOAST_MS. */
  sticky: boolean;
  session?: SessionKey;
  /** The attention this toast is about; the stack drops it when the attention clears. */
  attentionId?: string;
  /** Allow / Deny on the toast: a control answer can reach the prompt. */
  answerable?: boolean;
  title: string;
  /** Under the title: "permission", "error", "delivered"… coloured by kind. */
  label: string;
  tool?: string;
  body?: string;
  machine?: string;
  sound: SoundKind;
  at: number;
}

let toasts: readonly Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const commit = (next: readonly Toast[]) => {
  toasts = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
}

export function dismissToast(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (toasts.some((x) => x.id === id)) commit(toasts.filter((x) => x.id !== id));
}

/** Adds one toast (oldest first in the list) and plays its sound. A toast with the same
 *  id is replaced in place, with no second sound. */
export function pushToast(toast: Toast): void {
  const again = toasts.some((x) => x.id === toast.id);
  let next = again ? toasts.map((x) => (x.id === toast.id ? toast : x)) : [...toasts, toast];
  while (next.length > TOAST_MAX) {
    const victim = next.find((x) => !x.sticky) ?? next[0]!;
    const t = timers.get(victim.id);
    if (t) clearTimeout(t);
    timers.delete(victim.id);
    next = next.filter((x) => x !== victim);
  }
  commit(next);
  if (again) return;
  if (!toast.sticky)
    timers.set(
      toast.id,
      setTimeout(() => dismissToast(toast.id), TOAST_MS),
    );
  void playSound(toast.sound);
}

/** Drops the attention toasts whose attention is no longer open (`keep` is the set of
 *  `${session}|${attentionId}` still open). */
export function pruneAttentionToasts(keep: ReadonlySet<string>): void {
  const next = toasts.filter((t) => !t.attentionId || keep.has(`${t.session}|${t.attentionId}`));
  if (next.length !== toasts.length) {
    for (const t of toasts) if (!next.includes(t)) timers.delete(t.id);
    commit(next);
  }
}

// ----- what this page did itself -----

const own = new Set<string>();
/** Remembers a control message this page sent, by id (control/command.ts). */
export function noteOwnSend(id: string): void {
  own.add(id);
  if (own.size > 500) own.delete(own.values().next().value as string);
}
export const isOwnSend = (id: string): boolean => own.has(id);
