import React, { useCallback, useRef, useState } from 'react';
import { ConfirmDialog, ConfirmVariant } from '../components/ui/ConfirmDialog';

export interface ConfirmOptions {
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmVariant;
    /** See `ConfirmDialog` — gates the confirm button behind typing this string. */
    requireTypedConfirmation?: string;
}

export interface UseConfirmResult {
    /**
     * Opens the dialog and resolves to the learner's answer.
     *
     * Shaped to be a drop-in for `window.confirm`, so a call site changes from
     *
     *   if (!confirm('Delete this lesson?')) return;
     *
     * to
     *
     *   if (!(await confirm({ title: 'Delete lesson', message: '…' }))) return;
     *
     * and nothing else about the handler has to move.
     */
    confirm: (options: ConfirmOptions) => Promise<boolean>;
    /** Render this somewhere in the component's tree for `confirm` to work. */
    confirmDialog: React.ReactNode;
}

/**
 * Promise-based confirmation, rendered in-app.
 *
 * Deliberately a hook that hands back its own element rather than a global
 * provider: it needs no wiring in App.tsx, each screen owns the dialog it
 * shows, and a component can be dropped into any tree without a new context
 * having to be present above it.
 *
 * A request that is superseded (a second `confirm` call while one is already
 * open) resolves the first as `false`, so no caller is left awaiting a promise
 * that never settles.
 */
export const useConfirm = (): UseConfirmResult => {
    const [options, setOptions] = useState<ConfirmOptions | null>(null);
    const resolverRef = useRef<((value: boolean) => void) | null>(null);

    const settle = useCallback((value: boolean) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        setOptions(null);
        resolve?.(value);
    }, []);

    const confirm = useCallback(
        (next: ConfirmOptions): Promise<boolean> => {
            // Never strand a pending promise from a previous request.
            resolverRef.current?.(false);

            return new Promise<boolean>(resolve => {
                resolverRef.current = resolve;
                setOptions(next);
            });
        },
        []
    );

    const confirmDialog = (
        <ConfirmDialog
            isOpen={options !== null}
            title={options?.title ?? ''}
            message={options?.message ?? ''}
            confirmLabel={options?.confirmLabel}
            cancelLabel={options?.cancelLabel}
            variant={options?.variant}
            requireTypedConfirmation={options?.requireTypedConfirmation}
            onConfirm={() => settle(true)}
            onCancel={() => settle(false)}
        />
    );

    return { confirm, confirmDialog };
};
