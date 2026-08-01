import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MenuIcon } from './icons';

// Меню пользователя (§4.1): email, «Все задачи», «Выйти» через Cloudflare Access.

const LOGOUT_URL = '/cdn-cgi/access/logout';

interface UserMenuProps {
  email: string | null;
  onOpenTasks: () => void;
}

export function UserMenu({ email, onOpenTasks }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusOnOpen = useRef(0);

  useEffect(() => {
    if (open) itemRefs.current[focusOnOpen.current]?.focus();
  }, [open]);

  const openMenu = (itemIndex: number) => {
    focusOnOpen.current = itemIndex;
    setOpen(true);
  };

  const closeMenu = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openMenu(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="user-menu">
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        aria-label="Меню пользователя"
        aria-haspopup="menu"
        aria-controls={open ? 'user-menu-panel' : undefined}
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu(0))}
        onKeyDown={handleTriggerKeyDown}
      >
        <MenuIcon />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="menu-backdrop"
            aria-label="Закрыть меню"
            tabIndex={-1}
            onClick={() => closeMenu()}
          />
          <div
            id="user-menu-panel"
            className="menu-panel"
            role="menu"
            aria-label="Меню пользователя"
            onKeyDown={handleMenuKeyDown}
          >
            <div className="menu-email">{email ?? '…'}</div>
            <button
              ref={(element) => {
                itemRefs.current[0] = element;
              }}
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenTasks();
              }}
            >
              Все задачи
            </button>
            <button
              ref={(element) => {
                itemRefs.current[1] = element;
              }}
              type="button"
              className="menu-item"
              role="menuitem"
              onClick={() => {
                window.location.href = LOGOUT_URL;
              }}
            >
              Выйти
            </button>
          </div>
        </>
      )}
    </div>
  );
}
