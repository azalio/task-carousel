import { useState } from 'react';
import { MenuIcon } from './icons';

// Меню пользователя (§4.1): email, «Все задачи», «Выйти» через Cloudflare Access.

const LOGOUT_URL = '/cdn-cgi/access/logout';

interface UserMenuProps {
  email: string | null;
  onOpenTasks: () => void;
}

export function UserMenu({ email, onOpenTasks }: UserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="user-menu">
      <button
        type="button"
        className="icon-btn"
        aria-label="Меню пользователя"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MenuIcon />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="menu-backdrop"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          />
          <div className="menu-panel" role="menu">
            <div className="menu-email">{email ?? '…'}</div>
            <button
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
