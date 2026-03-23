import { useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme'

function getStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch { /* private browsing / SSR */ }
  return 'system'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStored)

  useEffect(() => {
    const root = document.documentElement

    function apply() {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }

    apply()

    // Re-apply when OS preference changes (only relevant in system mode)
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  function setTheme(next: Theme) {
    try {
      if (next === 'system') {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, next)
      }
    } catch { /* ignore */ }
    setThemeState(next)
  }

  return { theme, setTheme }
}
