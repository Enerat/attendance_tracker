import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const confirmBtnRef = useRef(null);
  const previousFocusRef = useRef(null);
  const dialogRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setState((current) => {
        // resolve any in-flight dialog as cancelled before replacing it
        if (current) current.resolve(false);
        return {
          title: opts?.title || 'Are you sure?',
          message: opts?.message || '',
          confirmLabel: opts?.confirmLabel || 'Confirm',
          cancelLabel: opts?.cancelLabel || 'Cancel',
          tone: opts?.tone || 'default',
          resolve,
        };
      });
    });
  }, []);

  const close = useCallback((result) => {
    setState((current) => {
      if (current) current.resolve(result);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!state) {
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && typeof prev.focus === 'function') {
        prev.focus();
      }
      return;
    }
    previousFocusRef.current = document.activeElement;
    confirmBtnRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    // scoped to the dialog so Enter on a focused button uses the browser default
    const node = dialogRef.current;
    node?.addEventListener('keydown', onKey);
    return () => node?.removeEventListener('keydown', onKey);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={() => close(false)}>
          <div
            ref={dialogRef}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title" className="confirm-title">{state.title}</h2>
            {state.message && <p className="confirm-message">{state.message}</p>}
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => close(false)}
              >
                {state.cancelLabel}
              </button>
              <button
                type="button"
                ref={confirmBtnRef}
                className={`btn ${state.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx;
}
