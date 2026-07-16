'use client'

import { useState, useEffect } from 'react'

const LOCAL_STORAGE_CHANGE_EVENT = 'localStorageChange'

type LocalStorageChangeDetail = { key: string; value: unknown }

function isLocalStorageChangeEvent(e: Event): e is CustomEvent<LocalStorageChangeDetail> {
  return (
    e instanceof CustomEvent &&
    e.detail != null &&
    typeof (e.detail as LocalStorageChangeDetail).key === 'string'
  )
}

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  // State to store our value
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue
    }
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // Listen for changes to localStorage from other components/tabs
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue !== null) {
        try {
          setStoredValue(JSON.parse(e.newValue))
        } catch (error) {
          console.error(`Error parsing localStorage value for key "${key}":`, error)
        }
      }
    }

    const handleCustomStorageChange = (e: Event) => {
      if (!isLocalStorageChangeEvent(e) || e.detail.key !== key) {
        return
      }
      setStoredValue(e.detail.value as T)
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleCustomStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleCustomStorageChange)
    }
  }, [key])

  // Return a wrapped version of useState's setter function that
  // persists the new value to localStorage and notifies other components.
  const setValue = (value: T) => {
    try {
      setStoredValue(value)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(value))
        // Dispatch custom event for same-tab updates (storage event only fires for other tabs)
        window.dispatchEvent(
          new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
            detail: { key, value },
          })
        )
      }
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error)
    }
  }

  return [storedValue, setValue]
}
