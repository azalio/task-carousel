// Небольшие инлайн-иконки (stroke: currentColor).

interface IconProps {
  size?: number;
}

function iconAttrs(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
}

export function PlusIcon({ size = 22 }: IconProps) {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MenuIcon({ size = 22 }: IconProps) {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function BackIcon({ size = 22 }: IconProps) {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 22 }: IconProps) {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M14 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 22 }: IconProps) {
  return (
    <svg {...iconAttrs(size)}>
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}
