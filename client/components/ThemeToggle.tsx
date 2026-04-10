'use client';

import { useState } from 'react';

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // ignore private browsing restriction
    }
  }

  return (
    <button
      onClick={toggle}
      className="shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors
        bg-zinc-800 text-zinc-300 hover:bg-zinc-700
        dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      aria-label="Toggle colour scheme"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? '☀' : '🌙'}
    </button>
  );
}
