import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export type ConfirmVariant = 'danger' | 'warning' | 'neutral';

export interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmVariant;
    /**
     * When set, the confirm button stays disabled until the learner types this
     * exact string. Reserved for actions that are both irreversible and
     * wide-reaching - deleting a course with its quiz, overwriting every
     * course from the seed templates - so those cannot be dismissed with the
     * same reflex click as deleting one quiz question.
     */
    requireTypedConfirmation?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const VARIANT_STYLES: Record<
    ConfirmVariant,
    { icon: React.ElementType; iconWrap: string; confirmButton: string }
> = {
    danger: {
        icon: Trash2,
        iconWrap: 'bg-red-500/10 text-red-500',
        confirmButton: 'bg-red-500 hover:bg-red-600 text-white',
    },
    warning: {
        icon: AlertTriangle,
        iconWrap: 'bg-amber-500/10 text-amber-500',
        confirmButton: 'bg-amber-500 hover:bg-amber-600 text-white',
    },
    neutral: {
        icon: HelpCircle,
        iconWrap: 'bg-primary/10 text-primaryLight',
        confirmButton: 'bg-gradient-main text-white hover:shadow-lg hover:shadow-primary/25',
    },
};

/**
 * In-app replacement for `window.confirm`.
 *
 * Modelled on the logout confirmation already in `Layout` — same backdrop,
 * panel and button pair — so a destructive action in the admin dashboard now
 * looks like the rest of the product instead of an unstyled OS dialog that
 * ignores the theme, the font-size setting and the reduced-motion preference.
 *
 * Behaviour that `confirm()` gave for free and has to be reimplemented:
 * focus moves into the dialog and returns to the trigger afterwards, Tab is
 * trapped inside it, Escape cancels, and the page behind cannot scroll.
 * Enter confirms, because the confirm button is focused on open.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'danger',
    requireTypedConfirmation,
    onConfirm,
    onCancel,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const [typed, setTyped] = useState('');

    // Reset the typed value whenever a new request opens, so a previous
    // dialog's input can never pre-arm the next one.
    useEffect(() => {
        if (isOpen) setTyped('');
    }, [isOpen, requireTypedConfirmation]);

    // Escape handling and focus restoration both live in the trap.
    useFocusTrap(panelRef, isOpen, onCancel);

    // The trap focuses the first focusable child, which is Cancel. Move focus
    // to the confirm button instead so Enter does the thing the dialog is
    // asking about — matching what confirm() did.
    useEffect(() => {
        if (!isOpen || requireTypedConfirmation) return;
        const timer = setTimeout(() => confirmButtonRef.current?.focus(), 0);
        return () => clearTimeout(timer);
    }, [isOpen, requireTypedConfirmation]);

    // Lock background scrolling for as long as the dialog is up.
    useEffect(() => {
        if (!isOpen) return;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const styles = VARIANT_STYLES[variant];
    const Icon = styles.icon;
    const titleId = 'confirm-dialog-title';
    const messageId = 'confirm-dialog-message';
    const typedInputId = 'confirm-dialog-typed';
    const isArmed = !requireTypedConfirmation || typed.trim() === requireTypedConfirmation;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />

            <div
                ref={panelRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
                tabIndex={-1}
                className="relative bg-background border border-black/20 dark:border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-fade-in-up"
            >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 mx-auto ${styles.iconWrap}`}>
                    <Icon size={24} />
                </div>

                <h3 id={titleId} className="text-xl font-bold text-textMain text-center mb-2">
                    {title}
                </h3>

                <div id={messageId} className="text-textMuted text-center mb-6 text-sm leading-relaxed">
                    {message}
                </div>

                {requireTypedConfirmation && (
                    <div className="mb-6">
                        <label htmlFor={typedInputId} className="block text-xs text-textMuted mb-2 text-center">
                            Type <span className="font-mono font-bold text-textMain">{requireTypedConfirmation}</span> to
                            confirm
                        </label>
                        <input
                            id={typedInputId}
                            type="text"
                            value={typed}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            onChange={e => setTyped(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && isArmed) onConfirm();
                            }}
                            className="w-full rounded-xl border border-black/20 dark:border-white/10 bg-white/60 dark:bg-white/5 px-3 py-2.5 text-sm text-textMain text-center font-mono focus:outline-none focus:ring-2 focus:ring-primaryLight"
                        />
                    </div>
                )}

                <div className="flex gap-4">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-textMain border border-black/20 dark:border-white/10 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={onConfirm}
                        disabled={!isArmed}
                        className={`flex-1 py-2.5 rounded-xl font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primaryLight focus-visible:ring-offset-2 focus-visible:ring-offset-background ${styles.confirmButton}`}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
