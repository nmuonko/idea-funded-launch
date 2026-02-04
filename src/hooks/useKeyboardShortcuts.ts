import { useEffect, useCallback } from 'react';

interface KeyboardShortcutOptions {
  onSearch?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

export function useKeyboardShortcuts({
  onSearch,
  onEscape,
  enabled = true,
}: KeyboardShortcutOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl + K to focus search
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        onSearch?.();
        return;
      }

      // "/" to focus search (only when not in input)
      if (event.key === '/' && !isInput) {
        event.preventDefault();
        onSearch?.();
        return;
      }

      // Escape to close modals
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }
    },
    [enabled, onSearch, onEscape]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
