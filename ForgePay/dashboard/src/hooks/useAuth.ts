import { useState, useEffect, useCallback } from 'react'

interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  apiKey: string | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    apiKey: null,
  })

  useEffect(() => {
    const apiKey = localStorage.getItem('apiKey')
    setState({
      isAuthenticated: !!apiKey,
      isLoading: false,
      apiKey,
    })
  }, [])

  const login = useCallback((apiKey: string) => {
    localStorage.setItem('apiKey', apiKey)
    setState({
      isAuthenticated: true,
      isLoading: false,
      apiKey,
    })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('apiKey')
    setState({
      isAuthenticated: false,
      isLoading: false,
      apiKey: null,
    })
  }, [])

  return {
    ...state,
    login,
    logout,
  }
}
