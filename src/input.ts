// src/input.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BackgroundRegistry } from "./state.ts";
import type { UiContext } from "./types.ts";
import { backgroundActiveForeground } from "./lifecycle.ts";

export function registerInputHandlers(pi: ExtensionAPI, reg: BackgroundRegistry): void {
    pi.on("input", async (event, ctx) => {
        // Cooperative steering (Claude Code parity): ANY input typed while a
        // foreground bash command is running backgrounds that command and
        // re-delivers the input as the next turn — regardless of the message's
        // steer/followUp streamingBehavior. We only intercept when there is an
        // active foreground slot; everything else falls through to Pi.
        if (!reg.activeToolCallId) return { action: "continue" };
        if (!reg.foreground.has(reg.activeToolCallId)) return { action: "continue" };
        // Don't intercept extension-sourced messages.
        if (event.source === "extension") return { action: "continue" };

        const text = event.text;
        const bg = backgroundActiveForeground(reg, pi, ctx as UiContext, {
            notifyAgent: false,
        });
        if (!bg) return { action: "continue" };

        // Abort the current turn so the bash tool returns the "backgrounded" result.
        ctx.abort?.();

        // Resubmit the user's message once the aborted run settles. Queueing it
        // as a followUp strands it: pi's post-run loop exits on the abort flag
        // without draining the follow-up queue (and the TUI's abort hook clears
        // the queues before a re-queue would land), so nothing ever delivers it.
        // Delivered as a fresh turn after agent_settled instead.
        const deliver = (): void => {
            try {
                pi.sendUserMessage(text);
            } catch {
                // Session ended between abort and resubmit — nothing to deliver to.
            }
        };
        if (ctx.isIdle()) {
            deliver();
        } else {
            const off = pi.on("agent_settled", () => {
                off();
                deliver();
            });
        }

        return { action: "handled" };
    });
}
